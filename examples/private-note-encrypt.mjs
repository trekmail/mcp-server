/** Local only. Read {text,password?} from stdin; upload ONLY result.envelope to API/MCP. */
import { encryptNote } from '../build/private-note-crypto.js';
let input='';
for await (const chunk of process.stdin) {
    input+=chunk;
    if(Buffer.byteLength(input)>32768) {process.stderr.write('Input exceeds the note limit.\n');process.exit(1);}
}
try {
    const {text,password=''}=JSON.parse(input);input='';
    process.stdout.write(JSON.stringify(await encryptNote(text,password))+'\n');
} catch { process.stderr.write('Cannot encrypt this note. Check text and password limits.\n');process.exitCode=1; }
