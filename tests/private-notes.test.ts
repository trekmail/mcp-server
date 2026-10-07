import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrekMailClient } from '../src/client.js';
import { registerPrivateNoteTools } from '../src/tools/private-notes.js';
import { encryptNote, unlockNote, decryptNote } from '../src/private-note-crypto.js';
import { TOOL_CATALOG_BY_NAME } from '../src/tool-catalog.js';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
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
    expect(schema.safeParse({version:1,iv:'A'.repeat(16),ciphertext:'B'.repeat(22000)}).success).toBe(false);
  });
});
