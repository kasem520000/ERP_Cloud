import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env } from '@erp/config';
import { DomainError, errorCodes } from '@erp/contracts';

/**
 * At-rest encryption for platform secrets — the MFA TOTP key in particular
 * (SECURITY_ARCHITECTURE §2: "`mfa_secret_enc` AES-GCM").
 *
 * Envelope format `v1:<iv b64>:<tag b64>:<ciphertext b64>` — deliberately identical to the
 * envelope used by the e-invoicing credentials, so one rotation procedure covers both. The
 * key is derived from `DATA_ENC_KEY` exactly the way those modules do (SHA-256 of the
 * configured secret). We never log the plaintext and never return it outside the module
 * that asked for it.
 */

const FALLBACK_KEY = 'local-development-data-key';

function keyBytes(secret?: string): Buffer {
  return createHash('sha256').update(secret ?? FALLBACK_KEY).digest();
}

/** AES-256-GCM seal. A fresh 12-byte IV per call; the auth tag is part of the envelope. */
export function sealSecret(plain: string | Buffer, key = env.DATA_ENC_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Opens a `v1:` envelope. Any tampering, a wrong key or a malformed payload throws — a
 * corrupted secret must never fail open into "no MFA".
 */
export function openSecret(payload: string, key = env.DATA_ENC_KEY): Buffer {
  const [version, iv64, tag64, data64] = payload.split(':');
  if (version !== 'v1' || !iv64 || !tag64 || !data64) {
    throw new DomainError(errorCodes.UNAUTHENTICATED, 'MFA secret is malformed', 401);
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(iv64, 'base64'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data64, 'base64')), decipher.final()]);
  } catch {
    throw new DomainError(errorCodes.UNAUTHENTICATED, 'MFA secret could not be decrypted', 401);
  }
}
