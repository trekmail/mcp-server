/** Local only. Read {text,password?} from stdin; upload ONLY result.envelope to API/MCP. */
import { encryptNote, MAX_NOTE_CHARACTERS } from '../build/private-note-crypto.js';
// Room for a full-size note even when every code point arrives JSON-escaped as a surrogate pair (12 bytes), plus the password.
const INPUT_LIMIT = 12 * MAX_NOTE_CHARACTERS + 16384;
let input='';
for await (const chunk of process.stdin) {
    input+=chunk;
    if(Buffer.byteLength(input)>INPUT_LIMIT) {process.stderr.write('Input exceeds the note limit.\n');process.exit(1);}
}
try {
    const {text,password=''}=JSON.parse(input);input='';
    process.stdout.write(JSON.stringify(await encryptNote(text,password))+'\n');
} catch { process.stderr.write('Cannot encrypt this note. Check text and password limits.\n');process.exitCode=1; }
