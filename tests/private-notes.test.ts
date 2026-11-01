import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrekMailClient } from '../src/client.js';
import { registerPrivateNoteTools } from '../src/tools/private-notes.js';
import { encryptNote, unlockNote, decryptNote, MAX_NOTE_CHARACTERS, MAX_CIPHERTEXT_BYTES, MAX_CIPHERTEXT_LENGTH } from '../src/private-note-crypto.js';
import { PRIVATE_NOTE_LEGACY_CIPHERTEXT_BYTES, PRIVATE_NOTE_MAX_CHARACTERS, PRIVATE_NOTE_MAX_CIPHERTEXT_BYTES, PRIVATE_NOTE_MAX_CIPHERTEXT_LENGTH } from '../src/private-note-limits.js';
import { TOOL_CATALOG_BY_NAME } from '../src/tool-catalog.js';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
/** The Private Notes tools over a real client, configured like a local install or like the hosted server. */
function consumeTools(config:{allowDestructive:boolean;httpTransport:boolean}){
  const tools=new Map<string,any>();
  const client=new TrekMailClient({baseUrl:'https://trekmail.test',token:'tm_live_test',timeoutMs:300,userAgent:'test'});
  registerPrivateNoteTools({registerTool:(name:string,schema:any,handler:any)=>tools.set(name,{schema,handler})} as any,client,config as any);
  return tools;
}
describe('Private Notes agent workflow',()=>{
  it('shares the browser protocol and checks the password before consumption',async()=>{
    const note=await encryptNote('<script>never execute</script> 🔒','separate-channel');
    await expect(unlockNote(note.fragment,'wrong')).rejects.toThrow();
    expect(await decryptNote(note.envelope,await unlockNote(note.fragment,'separate-channel'))).toContain('<script>');
    expect(note.envelope).not.toHaveProperty('fragment');
  });
  it('never retries an uncertain consume and redacts the capability in errors',async()=>{
    const fetch=vi.fn().mockRejectedValue(new TypeError('offline'));globalThis.fetch=fetch;
    const client=new TrekMailClient({baseUrl:'https://trekmail.test',token:'tm_live_test',timeoutMs:300,userAgent:'test'});
    await expect(client.consumePrivateNote('A'.repeat(43),{confirm_open:true})).rejects.toThrow('private-notes/[note]/consume');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
  });
  it('enforces destructive gates before calling the API',async()=>{
    const tools=new Map<string,any>();
    const server={registerTool:(name:string,schema:any,handler:any)=>tools.set(name,{schema,handler})};
    const client={consumePrivateNote:vi.fn(),revokePrivateNote:vi.fn()};
    registerPrivateNoteTools(server as any,client as any,{allowDestructive:false} as any);
    expect(tools.size).toBe(8);
    expect((await tools.get('consume_private_note_encrypted').handler({note_id:'A'.repeat(43),confirm_open:true})).isError).toBe(true);
    expect((await tools.get('revoke_private_note').handler({note_id:'A'.repeat(43)})).isError).toBe(true);
    expect(client.consumePrivateNote).not.toHaveBeenCalled();expect(client.revokePrivateNote).not.toHaveBeenCalled();
    expect(tools.get('get_private_note_status').schema.annotations.readOnlyHint).toBe(true);
    expect(JSON.stringify(TOOL_CATALOG_BY_NAME.get('consume_private_note_encrypted'))).toContain('private-notes:consume');
  });
  it('rejects plaintext inside the encrypted envelope and bounds its size',()=>{
    const tools=new Map<string,any>();registerPrivateNoteTools({registerTool:(n:string,s:any)=>tools.set(n,s)} as any,{} as any,{} as any);
    const schema=tools.get('create_private_note_encrypted').inputSchema.envelope;
    expect(schema.safeParse({version:1,iv:'A'.repeat(16),ciphertext:'B'.repeat(40),text:'secret'}).success).toBe(false);
    expect(schema.safeParse({version:1,iv:'A'.repeat(16),ciphertext:'B'.repeat(106688)}).success).toBe(true);
    expect(schema.safeParse({version:1,iv:'A'.repeat(16),ciphertext:'B'.repeat(106689)}).success).toBe(false);
  });
  it('restates the crypto module limits exactly',()=>{
    expect([PRIVATE_NOTE_MAX_CHARACTERS,PRIVATE_NOTE_MAX_CIPHERTEXT_BYTES,PRIVATE_NOTE_MAX_CIPHERTEXT_LENGTH]).toEqual([MAX_NOTE_CHARACTERS,MAX_CIPHERTEXT_BYTES,MAX_CIPHERTEXT_LENGTH]);
    expect([MAX_NOTE_CHARACTERS,MAX_CIPHERTEXT_BYTES,MAX_CIPHERTEXT_LENGTH]).toEqual([20000,80016,106688]);
    // A pre-20,000-character module: 16,384 plaintext bytes plus the tag (the server's LEGACY_CIPHERTEXT_BYTES).
    expect(PRIVATE_NOTE_LEGACY_CIPHERTEXT_BYTES).toBe(16400);
  });
  it('a full-size note fits the create schema and a local install declares what this package decrypts',async()=>{
    const note=await encryptNote('🔑'.repeat(MAX_NOTE_CHARACTERS));
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{envelope:note.envelope,policy:'once'}}),{status:200,headers:{'Content-Type':'application/json'}}));globalThis.fetch=fetch;
    const tools=consumeTools({allowDestructive:true,httpTransport:false});
    expect(tools.get('create_private_note_encrypted').schema.inputSchema.envelope.safeParse(note.envelope).success).toBe(true);
    expect(note.envelope.ciphertext.length).toBe(MAX_CIPHERTEXT_LENGTH);
    const result=await tools.get('consume_private_note_encrypted').handler({note_id:'A'.repeat(43),confirm_open:true,domain_id:7});
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({confirm_open:true,domain_id:7,max_ciphertext_bytes:80016});
    expect(await decryptNote(JSON.parse(result.content[0].text).data.envelope,await unlockNote(note.fragment))).toBe('🔑'.repeat(MAX_NOTE_CHARACTERS));
  });
  it('the hosted server declares only what the agent states about its own decryptor',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({data:{envelope:{version:1,iv:'A'.repeat(16),ciphertext:'B'.repeat(40)},policy:'once'}}),{status:200,headers:{'Content-Type':'application/json'}}));globalThis.fetch=fetch;
    const hosted=consumeTools({allowDestructive:true,httpTransport:true}).get('consume_private_note_encrypted');
    // Nothing stated: the server assumes a module from before 1.15.0 and refuses a note it could not open.
    await hosted.handler({note_id:'A'.repeat(43),confirm_open:true});
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({confirm_open:true});
    await hosted.handler({note_id:'A'.repeat(43),confirm_open:true,max_ciphertext_bytes:80016});
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({confirm_open:true,max_ciphertext_bytes:80016});
    // A local install still lets the agent name an older decryptor.
    await consumeTools({allowDestructive:true,httpTransport:false}).get('consume_private_note_encrypted').handler({note_id:'A'.repeat(43),confirm_open:true,max_ciphertext_bytes:16400});
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({confirm_open:true,max_ciphertext_bytes:16400});
    const declared=hosted.schema.inputSchema.max_ciphertext_bytes;
    expect([16400,80016,undefined].map(value=>declared.safeParse(value).success)).toEqual([true,true,true]);
    expect([16399,16,80016.5,'80016'].map(value=>declared.safeParse(value).success)).toEqual([false,false,false,false]);
  });
  it('the client sends a consume body exactly as given',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{}}),{status:200,headers:{'Content-Type':'application/json'}}));globalThis.fetch=fetch;
    const client=new TrekMailClient({baseUrl:'https://trekmail.test',token:'tm_live_test',timeoutMs:300,userAgent:'test'});
    await client.consumePrivateNote('A'.repeat(43),{confirm_open:true,mailbox_id:3});
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({confirm_open:true,mailbox_id:3});
  });
  it('a refused large note reaches the agent as the server explained it, with what to send instead',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({message:'Your app or agent is too old to open this note.',error:{code:'private_note_client_outdated',message:'Your app or agent is too old to open this note.',retryable:false}}),{status:409,headers:{'Content-Type':'application/json'}}));globalThis.fetch=fetch;
    const client=new TrekMailClient({baseUrl:'https://trekmail.test',token:'tm_live_test',timeoutMs:300,userAgent:'test'});
    await expect(client.consumePrivateNote('A'.repeat(43),{confirm_open:true})).rejects.toMatchObject({statusCode:409,code:'private_note_client_outdated'});
    expect(fetch).toHaveBeenCalledTimes(1);
    const result=await consumeTools({allowDestructive:true,httpTransport:true}).get('consume_private_note_encrypted').handler({note_id:'A'.repeat(43),confirm_open:true});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API Error [private_note_client_outdated]: Your app or agent is too old to open this note.');
    expect(result.content[0].text).toContain('Action: Nothing was consumed');
    expect(result.content[0].text).toContain('MAX_CIPHERTEXT_BYTES export');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
