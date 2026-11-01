/**
 * Private Notes size limits for the TypeScript side of the package (tool schemas and the API client).
 *
 * The protocol module private-note-crypto.js is plain JavaScript shared with the browser, and the hosted
 * HTTP server compiles this package's TypeScript without allowJs, so the numbers are restated here rather
 * than imported. tests/private-notes.test.ts keeps them equal to the crypto module, and the Laravel
 * PrivateNoteLimitsTest keeps both equal to config('private_notes.max_characters').
 */

/** Unicode code points a note may hold. */
export const PRIVATE_NOTE_MAX_CHARACTERS = 20_000;

/** The largest ciphertext this package can decrypt: 4 UTF-8 bytes per code point plus the 16-byte GCM tag. */
export const PRIVATE_NOTE_MAX_CIPHERTEXT_BYTES = 4 * PRIVATE_NOTE_MAX_CHARACTERS + 16;

/** Unpadded base64url length of that ciphertext, as the envelope carries it. */
export const PRIVATE_NOTE_MAX_CIPHERTEXT_LENGTH = Math.ceil((PRIVATE_NOTE_MAX_CIPHERTEXT_BYTES * 4) / 3);

/**
 * The largest ciphertext a module from before the 20,000-character limit decrypts (16,384 plaintext bytes plus
 * the tag). The server assumes it for a consume that declares nothing and refuses smaller declarations.
 */
export const PRIVATE_NOTE_LEGACY_CIPHERTEXT_BYTES = 16_400;
