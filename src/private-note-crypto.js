/** Private Notes v1: AES-256-GCM, fresh IVs, authenticated key wrapping.
 * The fragment is never uploaded. Password checking happens before consumption.
 * No storage, analytics or HTML parsing is used by this module.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const AAD = encoder.encode('TrekMail Private Notes v1');
const WRAP_AAD = encoder.encode('TrekMail Private Notes v1 key');
export const PASSWORD_ITERATIONS = 600000;
/** The visible limit in Unicode code points. The server mirrors it in config('private_notes.max_characters'). */
export const MAX_NOTE_CHARACTERS = 20000;
/** UTF-8 takes at most 4 bytes per code point, so this cap can never refuse a note the character limit allows. */
export const MAX_NOTE_BYTES = 4 * MAX_NOTE_CHARACTERS;
/** The plaintext plus its 16-byte AES-GCM tag: the largest ciphertext this module creates or opens. */
export const MAX_CIPHERTEXT_BYTES = MAX_NOTE_BYTES + 16;
/** Unpadded base64url length of the largest ciphertext, as the envelope carries it. */
export const MAX_CIPHERTEXT_LENGTH = Math.ceil(MAX_CIPHERTEXT_BYTES * 4 / 3);
/** Bytes per String.fromCharCode call: spreading a large array overflows the call stack in Safari. */
export const BASE64_CHUNK_BYTES = 8192;

export function base64url(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    let binary = '';
    for (let offset = 0; offset < view.length; offset += BASE64_CHUNK_BYTES) {
        binary += String.fromCharCode(...view.subarray(offset, offset + BASE64_CHUNK_BYTES));
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unbase64url(text, max = 24000) {
    if (typeof text !== 'string' || text.length > max || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid note format');
    return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
function random(length) { return crypto.getRandomValues(new Uint8Array(length)); }
async function aes(bytes) { return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function wrappingKey(seed, password, salt) {
    let input = seed;
    if (password) {
        if (Array.from(password).length > 256) throw new Error('Password too long');
        const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
        const stretched = new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS}, material, 256));
        input = new Uint8Array([...seed, ...stretched]);
    }
    const material = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:WRAP_AAD}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export async function encryptNote(text, password = '') {
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > MAX_NOTE_CHARACTERS || encoder.encode(text).length > MAX_NOTE_BYTES) {
        throw new Error(`Note must contain 1–${MAX_NOTE_CHARACTERS.toLocaleString('en-US')} characters`);
    }
    const bytes = random(32), seed = random(32), salt = random(16), iv = random(12), wrapIv = random(12);
    const key = await aes(bytes);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128}, key, encoder.encode(text)));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:wrapIv,additionalData:WRAP_AAD,tagLength:128}, await wrappingKey(seed,password,salt), bytes));
    const fragment = base64url(encoder.encode(JSON.stringify({v:1,s:base64url(seed),salt:base64url(salt),iv:base64url(wrapIv),w:base64url(wrapped),p:!!password})));
    bytes.fill(0);
    return {envelope:{version:1,iv:base64url(iv),ciphertext:base64url(ciphertext)},fragment};
}
export function fragmentInfo(fragment) {
    const info = JSON.parse(decoder.decode(unbase64url(fragment, 700)));
    if (info.v !== 1 || typeof info.p !== 'boolean' || unbase64url(info.s).length !== 32 || unbase64url(info.salt).length !== 16
        || unbase64url(info.iv).length !== 12 || unbase64url(info.w).length !== 48) throw new Error('Invalid note format');
    return info;
}
export async function unlockNote(fragment, password = '') {
    const info = fragmentInfo(fragment);
    if (info.p && !password) throw new Error('Password required');
    const key = await wrappingKey(unbase64url(info.s), info.p ? password : '', unbase64url(info.salt));
    const bytes = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64url(info.iv),additionalData:WRAP_AAD,tagLength:128}, key, unbase64url(info.w)));
    const result = await aes(bytes);
    bytes.fill(0);
    return result;
}
export async function decryptNote(envelope, key) {
    if (envelope.version !== 1 || unbase64url(envelope.iv).length !== 12) throw new Error('Invalid note format');
    const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64url(envelope.iv),additionalData:AAD,tagLength:128}, key, unbase64url(envelope.ciphertext, MAX_CIPHERTEXT_LENGTH));
    return decoder.decode(bytes);
}
