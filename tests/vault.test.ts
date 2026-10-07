import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decrypt } from '../src/crypto/crypto';
import {
  MIN_PASSWORD_LENGTH,
  PasswordMismatchError,
  VaultExistsError,
  createVault,
  getVaultMeta,
  lockVault,
  unlockVault,
  validateMasterPassword,
  vaultExists,
} from '../src/vault/vault';
import { VaultNotFoundError } from '../src/vault/vault';
import { ValidationError } from '../src/errors';
import { VERIFIER_PLAINTEXT } from '../src/types/vault';
import { cleanupAll, makeDb } from './helpers';

describe('vault', () => {
  afterAll(cleanupAll);

  it('reports that no vault exists before creation', async () => {
    const { db } = makeDb();
    expect(vaultExists(db)).toBe(false);
    expect(() => getVaultMeta(db)).toThrow(VaultNotFoundError);
  });

  it('creates a vault with KDF metadata and an encrypted verifier', async () => {
    const { db } = makeDb();
    await createVault(db, 'Sup3rSecret!42', 'Sup3rSecret!42');
    expect(vaultExists(db)).toBe(true);
    const meta = getVaultMeta(db);
    expect(Buffer.from(meta.kdfSalt, 'base64').length).toBe(16);
    expect(meta.kdfParams).toEqual({ memoryCost: 65536, timeCost: 3, parallelism: 4 });
    expect(meta.verifier).not.toContain(VERIFIER_PLAINTEXT);
  });

  it('unlocks with the correct password and returns a 32-byte key', async () => {
    const { db } = makeDb();
    await createVault(db, 'Sup3rSecret!42', 'Sup3rSecret!42');
    const key = await unlockVault(db, 'Sup3rSecret!42');
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
    // the stored verifier decrypts back to the known constant
    const meta = getVaultMeta(db);
    expect(decrypt(key!, meta.verifier)).toBe(VERIFIER_PLAINTEXT);
    lockVault(key!);
    expect(key!.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { db } = makeDb();
    await createVault(db, 'Sup3rSecret!42', 'Sup3rSecret!42');
    expect(await unlockVault(db, 'wrong-password')).toBeNull();
  });

  it('rejects mismatched password confirmation on creation', async () => {
    const { db } = makeDb();
    await expect(createVault(db, 'Sup3rSecret!42', 'Different123!')).rejects.toThrow(
      PasswordMismatchError,
    );
    expect(vaultExists(db)).toBe(false);
  });

  it('rejects a too-short master password', async () => {
    const { db } = makeDb();
    await expect(createVault(db, 'short', 'short')).rejects.toThrow(ValidationError);
    expect(() => validateMasterPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(
      ValidationError,
    );
    expect(() => validateMasterPassword('short')).toThrow(/at least 8/);
  });

  it('refuses to create a second vault', async () => {
    const { db } = makeDb();
    await createVault(db, 'Sup3rSecret!42', 'Sup3rSecret!42');
    await expect(createVault(db, 'Another123!', 'Another123!')).rejects.toThrow(VaultExistsError);
  });

  it('never stores the master password or plaintext verifier on disk', async () => {
    const { db, dir } = makeDb();
    const password = 'UniqueSecretPhrase42!';
    await createVault(db, password, password);
    db.close();
    for (const fileName of ['test.db', 'test.db-wal', 'test.db-shm']) {
      let content: Buffer;
      try {
        content = readFileSync(join(dir, fileName));
      } catch {
        continue; // WAL side files may not exist
      }
      expect(content.includes(password)).toBe(false);
      expect(content.includes(VERIFIER_PLAINTEXT)).toBe(false);
    }
  });
});
