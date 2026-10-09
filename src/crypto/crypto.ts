import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppError } from '../errors';
import type { KdfParams } from '../types/vault';

export class CryptoError extends AppError {}

export const KEY_LENGTH = 32;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const SALT_LENGTH = 16;

export function generateSalt(length: number = SALT_LENGTH): Buffer {
  return randomBytes(length);
}

/**
 * Derives the 32-byte AES key from the master password with Argon2id.
 * The same (password, salt, params) pair always produces the same key.
 */
export async function deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    hashLength: KEY_LENGTH,
    raw: true,
    salt,
  });
}

/**
 * Encrypts plaintext with AES-256-GCM using a fresh random nonce.
 * Returns base64(nonce | ciphertext | tag).
 */
export function encrypt(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

/**
 * Decrypts a blob produced by encrypt().
 * Throws CryptoError when the key is wrong or the data was tampered with
 * (GCM authentication tag check fails).
 */
export function decrypt(key: Buffer, blob: string): string {
  let raw: Buffer;
  try {
    raw = Buffer.from(blob, 'base64');
  } catch {
    throw new CryptoError('Сохранённое значение не является корректными данными base64.');
  }
  if (raw.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new CryptoError('Сохранённое значение повреждено (слишком короткое).');
  }
  const nonce = raw.subarray(0, NONCE_LENGTH);
  const tag = raw.subarray(raw.length - TAG_LENGTH);
  const ciphertext = raw.subarray(NONCE_LENGTH, raw.length - TAG_LENGTH);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CryptoError('Не удалось расшифровать данные: неверный ключ или данные повреждены.');
  }
}

/** Overwrites the buffer contents with zeros. */
export function zeroFill(buffer: Buffer): void {
  buffer.fill(0);
}
