import {
  CryptoError,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  zeroFill,
} from '../crypto/crypto';
import { nowIso } from '../database/database';
import type { Db } from '../database/database';
import { AppError, ValidationError } from '../errors';
import { DEFAULT_KDF_PARAMS, VERIFIER_PLAINTEXT } from '../types/vault';
import type { KdfParams, VaultMeta } from '../types/vault';

export class VaultExistsError extends AppError {}
export class VaultNotFoundError extends AppError {}
export class PasswordMismatchError extends ValidationError {}

export const MIN_PASSWORD_LENGTH = 8;

interface VaultMetaRow {
  kdf_salt: string;
  kdf_params: string;
  verifier: string;
}

export function vaultExists(db: Db): boolean {
  const row = db.prepare('SELECT id FROM vault_meta WHERE id = 1').get();
  return row !== undefined;
}

export function getVaultMeta(db: Db): VaultMeta {
  const row = db
    .prepare('SELECT kdf_salt, kdf_params, verifier FROM vault_meta WHERE id = 1')
    .get() as VaultMetaRow | undefined;
  if (row === undefined) {
    throw new VaultNotFoundError('Хранилище не найдено. Сначала создайте хранилище.');
  }
  return {
    kdfSalt: row.kdf_salt,
    kdfParams: JSON.parse(row.kdf_params) as KdfParams,
    verifier: row.verifier,
  };
}

export function validateMasterPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Мастер-пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов.`,
    );
  }
}

/**
 * Creates the vault: derives the key from the master password, encrypts the
 * verifier constant and stores KDF metadata. Returns the derived key — the
 * caller keeps it in memory only until the vault is locked again (lockVault).
 */
export async function createVault(db: Db, password: string, confirmPassword: string): Promise<Buffer> {
  if (vaultExists(db)) {
    throw new VaultExistsError('Хранилище уже существует.');
  }
  validateMasterPassword(password);
  if (password !== confirmPassword) {
    throw new PasswordMismatchError('Пароли не совпадают.');
  }
  const salt = generateSalt();
  const key = await deriveKey(password, salt, DEFAULT_KDF_PARAMS);
  const verifier = encrypt(key, VERIFIER_PLAINTEXT);
  const now = nowIso();
  db.prepare(
    'INSERT INTO vault_meta (id, kdf_salt, kdf_params, verifier, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)',
  ).run(salt.toString('base64'), JSON.stringify(DEFAULT_KDF_PARAMS), verifier, now, now);
  return key;
}

/**
 * Verifies the master password against the encrypted verifier.
 * Returns the derived key kept in memory, or null when the password is wrong
 * (the failed key material is zero-filled immediately).
 */
export async function unlockVault(db: Db, password: string): Promise<Buffer | null> {
  const meta = getVaultMeta(db);
  const salt = Buffer.from(meta.kdfSalt, 'base64');
  const key = await deriveKey(password, salt, meta.kdfParams);
  try {
    const verifier = decrypt(key, meta.verifier);
    if (verifier !== VERIFIER_PLAINTEXT) {
      throw new CryptoError('Verifier mismatch.');
    }
    return key;
  } catch {
    zeroFill(key);
    return null;
  }
}

/** Clears the key material from memory. */
export function lockVault(key: Buffer): void {
  zeroFill(key);
}
