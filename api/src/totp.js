// The second step of the admin login: a 6-digit code from an authenticator app (TOTP, RFC 6238:
// HMAC-SHA1, 30-second steps), from the secret ADMIN_TOTP_SECRET (base32, made by admin-2fa.fish).
// A code is accepted one step early or late (clocks drift), and never twice.

import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/* base32 (what authenticator apps use) to bytes; null when it isn't base32 */
export function base32Decode(text) {
    const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
    if (!clean || /[^A-Z2-7]/.test(clean)) return null;
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const char of clean) {
        value = (value << 5) | ALPHABET.indexOf(char);
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/* the code for one 30-second step */
export function codeFor(secret, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = crypto.createHmac("sha1", secret).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return String(number).padStart(6, "0");
}

// the newest step a code was accepted for: an older or the same one is a replay
let lastUsedStep = -1;

/* the step the code belongs to when it is right now (or one step either side) and hasn't been
   used yet, else -1. it only counts as used once useCode() is called (after the whole login worked),
   so a wrong token doesn't burn a good code */
export function checkCode(secret, code, now = Date.now()) {
    if (!/^\d{6}$/.test(String(code || ""))) return -1;
    const current = Math.floor(now / 30_000);
    for (const step of [current - 1, current, current + 1]) {
        const expected = Buffer.from(codeFor(secret, step));
        if (crypto.timingSafeEqual(expected, Buffer.from(String(code))) && step > lastUsedStep) return step;
    }
    return -1;
}

export function useCode(step) {
    lastUsedStep = Math.max(lastUsedStep, step);
}
