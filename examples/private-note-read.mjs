/** Local only. Read {envelope,fragment,password?} from stdin. Never evaluates note text. */
import { unlockNote, decryptNote, MAX_CIPHERTEXT_LENGTH } from '../build/private-note-crypto.js';
// The largest envelope plus the fragment and an escaped password.
const INPUT_LIMIT = MAX_CIPHERTEXT_LENGTH + 16384;
let input='';
for await (const chunk of process.stdin) {input+=chunk;if(Buffer.byteLength(input)>INPUT_LIMIT)process.exit(1);}
try {
    const {envelope,fragment,password=''}=JSON.parse(input);input='';
    process.stdout.write(await decryptNote(envelope,await unlockNote(fragment,password))+'\n');
} catch {process.stderr.write('Cannot decrypt this note.\n');process.exitCode=1;}
