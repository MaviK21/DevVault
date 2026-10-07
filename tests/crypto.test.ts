import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  zeroFill,
} from '../src/crypto/crypto';
import { DEFAULT_KDF_PARAMS } from '../src/types/vault';

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 9);

describe('crypto', () => {

  it('round-trips encrypt/decrypt', () => {
    const secret = 'p@ssw0rd-Пароль-🔑';
    const blob = encrypt(key, secret);
    expect(blob).not.toContain(secret);
    expect(decrypt(key, blob)).toBe(secret);
  });

  it('rejects a wrong key (GCM authentication)', () => {
    const blob = encrypt(key, 'secret value');
    expect(() => decrypt(otherKey, blob)).toThrow(CryptoError);
  });

  it('rejects corrupted ciphertext', () => {
    const blob = encrypt(key, 'secret value');
    const raw = Buffer.from(blob, 'base64');
    const middle = Math.floor(raw.length / 2);
    raw[middle] = raw[middle]! ^ 0x01;
    expect(() => decrypt(key, raw.toString('base64'))).toThrow(CryptoError);
  });

  it('rejects truncated blobs', () => {
    expect(() => decrypt(key, Buffer.from('tooshort').toString('base64'))).toThrow(CryptoError);
  });

  it('uses a unique nonce for every encryption', () => {
    const first = Buffer.from(encrypt(key, 'same plaintext'), 'base64');
    const second = Buffer.from(encrypt(key, 'same plaintext'), 'base64');
    expect(first.equals(second)).toBe(false);
    expect(first.subarray(0, 12).equals(second.subarray(0, 12))).toBe(false);
  });

  it('generates 16-byte random salts', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1.length).toBe(16);
    expect(salt1.equals(salt2)).toBe(false);
  });

  it('derives a deterministic 32-byte Argon2id key', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('master password', salt, DEFAULT_KDF_PARAMS);
    const key2 = await deriveKey('master password', salt, DEFAULT_KDF_PARAMS);
    const key3 = await deriveKey('master password ', salt, DEFAULT_KDF_PARAMS);
    expect(key1.length).toBe(32);
    expect(key1.equals(key2)).toBe(true);
    expect(key1.equals(key3)).toBe(false);
  });

  it('changes the key when KDF parameters change', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('master password', salt, DEFAULT_KDF_PARAMS);
    const key2 = await deriveKey('master password', salt, { ...DEFAULT_KDF_PARAMS, timeCost: 4 });
    expect(key1.equals(key2)).toBe(false);
  });

  it('zero-fills key buffers', () => {
    const buffer = Buffer.alloc(32, 1);
    zeroFill(buffer);
    expect(buffer.every((byte) => byte === 0)).toBe(true);
  });
});
