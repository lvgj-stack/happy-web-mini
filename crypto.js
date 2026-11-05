// Happy account crypto for the browser. Mirrors
// packages/happy-ios/Sources/HappyCrypto (AccountKeys, SecretKeyBackup) and
// packages/happy-cli/src/api/encryption.ts. Needs window.nacl (tweetnacl).
// AES-GCM and HMAC come from @noble (pure JS) instead of crypto.subtle, so
// the page also works on plain http, where browsers withhold crypto.subtle.

import { gcm } from './node_modules/@noble/ciphers/aes.js';
import { hmac } from './node_modules/@noble/hashes/hmac.js';
import { sha512 } from './node_modules/@noble/hashes/sha2.js';

const nacl = window.nacl;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

export function unb64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

export function b64url(bytes) {
    return b64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function unb64url(str) {
    const s = str.replaceAll('-', '+').replaceAll('_', '/');
    return unb64(s + '='.repeat((4 - (s.length % 4)) % 4));
}

function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

async function hmac512(key, data) {
    return hmac(sha512, key, data);
}

// Key tree: packages/happy-ios/scripts/generate-crypto-vectors.mjs deriveKey()
export async function deriveKey(master, usage, path) {
    let I = await hmac512(enc.encode(usage + ' Master Seed'), master);
    let chain = I.slice(32);
    let key = I.slice(0, 32);
    for (const index of path) {
        I = await hmac512(chain, concat(new Uint8Array([0]), enc.encode(index)));
        key = I.slice(0, 32);
        chain = I.slice(32);
    }
    return key;
}

// libsodium crypto_box_seed_keypair: secret = SHA-512(seed)[0..32]
function boxSeedKeyPair(seed) {
    return nacl.box.keyPair.fromSecretKey(nacl.hash(seed).slice(0, 32));
}

/** Every key derived from the 32-byte account secret. */
export async function accountKeys(secret) {
    if (secret.length !== 32) throw new Error('secret must be 32 bytes');
    const contentSeed = await deriveKey(secret, 'Happy EnCoder', ['content']);
    return {
        secret,
        content: boxSeedKeyPair(contentSeed),
        signing: nacl.sign.keyPair.fromSeed(secret),
    };
}

// [ephPublicKey(32) | nonce(24) | box]
export function openAnonymous(bundle, recipientSecretKey) {
    if (bundle.length < 32 + 24 + 16) return null;
    return nacl.box.open(bundle.slice(56), bundle.slice(32, 56), bundle.slice(0, 32), recipientSecretKey);
}

/** Server-stored dataEncryptionKey: 0x00 || anonymous box to the content key. */
export function unwrapDataKey(keys, wrappedB64) {
    if (!wrappedB64) return null;
    const bytes = unb64(wrappedB64);
    if (bytes[0] !== 0) return null;
    const key = openAnonymous(bytes.slice(1), keys.content.secretKey);
    return key && key.length === 32 ? key : null;
}

// AES-256-GCM bundle: [version 0 | nonce(12) | ciphertext | tag(16)]
export async function decryptJSON(dataKey, b64Bundle) {
    try {
        const bundle = unb64(b64Bundle);
        if (bundle[0] !== 0 || bundle.length < 29) return null;
        const plain = gcm(dataKey, bundle.slice(1, 13)).decrypt(bundle.slice(13));
        return JSON.parse(dec.decode(plain));
    } catch {
        return null;
    }
}

export async function encryptJSON(dataKey, value) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = gcm(dataKey, nonce).encrypt(enc.encode(JSON.stringify(value)));
    return b64(concat(new Uint8Array([0]), nonce, ct));
}

/** crypto.randomUUID is also secure-context only. */
export function uuid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** POST /v1/auth body proving ownership of the account. */
export function authChallenge(keys) {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = nacl.sign.detached(challenge, keys.signing.secretKey);
    return { publicKey: b64(keys.signing.publicKey), challenge: b64(challenge), signature: b64(signature) };
}

/** Backup key (base32 groups) or raw base64url secret -> 32 bytes. */
export function parseSecretKey(input) {
    const trimmed = input.trim();
    if (trimmed.length === 43) {
        try {
            const raw = unb64url(trimmed);
            if (raw.length === 32) return raw;
        } catch { /* fall through to base32 */ }
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const look = { '0': 'O', '1': 'I', '8': 'B', '9': 'G' };
    const out = [];
    let buffer = 0, bits = 0;
    for (let ch of trimmed.toUpperCase()) {
        ch = look[ch] ?? ch;
        const v = alphabet.indexOf(ch);
        if (v < 0) continue;
        buffer = ((buffer << 5) | v) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
    }
    if (out.length !== 32) throw new Error(`密钥长度不对（解析出 ${out.length} 字节，应为 32）`);
    return new Uint8Array(out);
}

// ---------- Attachment blobs ----------
// happy-app encryptBlob: nonce(24) || secretbox(MAC 16 || ciphertext), keyed by
// deriveKey(dataKey, 'Happy Blobs', ['session']) (happy-ios BlobCipher, happy-cli apiSession).

export function blobKey(dataKey) {
    return deriveKey(dataKey, 'Happy Blobs', ['session']);
}

export function sealBlob(bytes, key) {
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    return concat(nonce, nacl.secretbox(bytes, nonce, key));
}

export function openBlob(bundle, key) {
    if (bundle.length < 24 + 16) return null;
    return nacl.secretbox.open(bundle.slice(24), bundle.slice(0, 24), key);
}
