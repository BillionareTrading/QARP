// crypto.js — browser-side decryption of payload.enc.
// Must stay in lockstep with encrypt_data.py:
//   key = PBKDF2-HMAC-SHA256(password, salt, iterations) -> 256-bit
//   plaintext = AES-256-GCM.decrypt(key, iv, ct||tag)

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Returns the parsed data object, or throws on wrong password / corrupt data.
async function decryptPayload(payload, password) {
  const enc = new TextEncoder();
  const salt = b64ToBytes(payload.salt);
  const iv = b64ToBytes(payload.iv);
  const ct = b64ToBytes(payload.ct);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: payload.iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // Throws OperationError if the auth tag fails (wrong password / tampered data).
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
  const u8 = new Uint8Array(plainBuf);
  // v2 payloads are gzipped JSON (encrypt_data.py compresses before encrypting).
  // Sniff the gzip magic bytes so v1 (raw JSON, starts with '{') keeps working.
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(plainBuf));
}
