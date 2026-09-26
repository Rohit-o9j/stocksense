/**
 * Password hashing using PBKDF2-SHA256 via WebCrypto.
 *
 * WebCrypto rather than bcrypt/argon2 so the same code runs in Node, Bun and
 * the Cloudflare Workers runtime this project builds for — native addons do
 * not. Stored format is self-describing, so the iteration count can be raised
 * later without invalidating existing hashes:
 *
 *   pbkdf2$<iterations>$<salt base64>$<derived key base64>
 */

const ITERATIONS = 210_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    KEY_BYTES * 8,
  );

  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

/** Constant-time comparison so verification does not leak the hash byte by byte. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  const [scheme, iterationsRaw, saltRaw, hashRaw] = parts;

  if (
    parts.length !== 4 ||
    scheme !== "pbkdf2" ||
    iterationsRaw === undefined ||
    saltRaw === undefined ||
    hashRaw === undefined
  ) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const derived = await derive(password, fromBase64(saltRaw), iterations);
  return equalBytes(derived, fromBase64(hashRaw));
}
