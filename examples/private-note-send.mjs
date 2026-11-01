/** Explicit local-agent workflow. Plaintext/password stay in this process. */
import { encryptNote, MAX_NOTE_CHARACTERS } from '../build/private-note-crypto.js';
import { pathToFileURL } from 'node:url';

export async function createAndSendPrivateNote(input, transport = fetch) {
    const {origin,noteToken,sendToken,text,password='',to,subject='Private note',domainId,mailboxId,sendConfirmed}=input;
    const base=new URL(origin);
    if(base.username || base.password || base.search || base.hash || (base.protocol!=='https:' && !(base.protocol==='http:' && ['127.0.0.1','localhost'].includes(base.hostname)))) throw new Error('Use an HTTPS API origin.');
    if(sendConfirmed!==true || !noteToken || !sendToken || !Array.isArray(to) || !to.length) throw new Error('Explicit send confirmation, both permissions and recipients are required.');
    const {envelope,fragment}=await encryptNote(text,password);
    const create=await transport(new URL('/api/v1/private-notes',base),{method:'POST',headers:{Authorization:'Bearer '+noteToken,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({envelope,policy:'once',expires_in:86400,confirm_open:true,notify_self:false,idempotency_key:crypto.randomUUID(),...(domainId?{domain_id:domainId}:{}),...(mailboxId?{mailbox_id:mailboxId}:{})})});
    if(!create.ok) throw new Error('Private note creation failed.');
    const {data:note}=await create.json();
    const link=new URL(note.reader_url); link.hash=fragment;
    if(!/^\/n\/[A-Za-z0-9_-]{43}$/.test(link.pathname) || link.search || link.username || link.password || (link.protocol!=='https:' && !(link.protocol==='http:' && ['127.0.0.1','localhost'].includes(link.hostname)))) throw new Error('Invalid reader URL returned by API.');
    const safeLink=link.href.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const requestId=crypto.randomUUID();
    let response;
    try {
        response=await transport(new URL('/api/v1/messages/send',base),{method:'POST',headers:{Authorization:'Bearer '+sendToken,'Content-Type':'application/json',Accept:'application/json','Idempotency-Key':requestId},body:JSON.stringify({to,subject,body:{text:'Open your private note: '+link.href,html:'<div class="private-note"><strong>Private note</strong><p><a href="'+safeLink+'" style="display:inline-block;padding:10px 16px;border:1px solid #d9dce9;border-radius:8px;text-decoration:none">Open private note</a></p></div>'}})});
    } catch {
        // Never retry or revoke automatically after an uncertain send.
        const error=new Error('Message status is uncertain. Check delivery status before retrying.');
        error.requestId=requestId; error.noteId=note.id; throw error;
    }
    if(!response.ok) {const error=new Error('Message was not accepted. Keep the note until delivery status is resolved.');error.requestId=requestId;error.noteId=note.id;throw error;}
    return {noteId:note.id,requestId,accepted:true}; // No plaintext/password/full link in output.
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
    let input='';
    try {
        // A full-size note even when every code point is JSON-escaped as a surrogate pair, plus recipients and settings.
        for await(const chunk of process.stdin) {input+=chunk;if(Buffer.byteLength(input)>12*MAX_NOTE_CHARACTERS+16384)throw new Error('Input exceeds the limit.');}
        const data=JSON.parse(input);input='';
        const result=await createAndSendPrivateNote({...data,origin:process.env.TREKMAIL_API_ORIGIN,noteToken:process.env.TREKMAIL_NOTE_TOKEN,sendToken:process.env.TREKMAIL_SEND_TOKEN});
        process.stdout.write(JSON.stringify(result)+'\n');
    } catch(error) {process.stderr.write(JSON.stringify({error:error.message,requestId:error.requestId,noteId:error.noteId})+'\n');process.exitCode=1;}
}
