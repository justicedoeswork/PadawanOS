/**
 * Verifies a login attempt against whichever of PADAWAN_GATEWAY_PASSWORD /
 * PADAWAN_GATEWAY_PASSWORD_HASH is configured. No third-party hashing
 * dependency: scrypt is built into Node and is a legitimate password
 * hash (memory-hard, unlike a bare HMAC), avoiding one more supply-chain
 * dependency for a single-owner tool's one credential.
 *
 * Hash format: "<salt-hex>:<derived-key-hex>", derived key is 64 bytes.
 * Generate one with:
 *   node -e "const c=require('node:crypto');const salt=c.randomBytes(16).toString('hex');c.scrypt(process.argv[1],salt,64,(e,k)=>console.log(salt+':'+k.toString('hex')))" '<password>'
 */
import crypto from 'node:crypto';

const SCRYPT_KEY_LENGTH = 64;

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function safeEqualStrings(a: string, b: string): boolean {
  return safeEqualBuffers(Buffer.from(a), Buffer.from(b));
}

function verifyAgainstHash(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(':');

  if (!salt || !expectedHex) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (err, derivedKey) => {
      if (err) {
        resolve(false);
        return;
      }

      const expected = Buffer.from(expectedHex, 'hex');
      resolve(expected.length === SCRYPT_KEY_LENGTH && safeEqualBuffers(derivedKey, expected));
    });
  });
}

export async function verifyPassword(
  candidate: string,
  { plainPassword, passwordHash }: { plainPassword: string | null; passwordHash: string | null }
): Promise<boolean> {
  if (passwordHash) {
    return verifyAgainstHash(candidate, passwordHash);
  }

  if (plainPassword) {
    return safeEqualStrings(candidate, plainPassword);
  }

  return false;
}
