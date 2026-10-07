/** Local only. Read {envelope,fragment,password?} from stdin. Never evaluates note text. */
import { unlockNote, decryptNote } from '../build/private-note-crypto.js';
let input='';
for await (const chunk of process.stdin) {input+=chunk;if(Buffer.byteLength(input)>32768)process.exit(1);}
try {
    const {envelope,fragment,password=''}=JSON.parse(input);input='';
    process.stdout.write(await decryptNote(envelope,await unlockNote(fragment,password))+'\n');
} catch {process.stderr.write('Cannot decrypt this note.\n');process.exitCode=1;}
