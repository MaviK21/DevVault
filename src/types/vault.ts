export interface KdfParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

/** Known constant encrypted with the master-password-derived key (see ТЗ §10). */
export const VERIFIER_PLAINTEXT = 'DEVVAULT_VERIFIER';

export interface VaultMeta {
  /** base64-encoded Argon2id salt */
  kdfSalt: string;
  kdfParams: KdfParams;
  /** base64(nonce | ciphertext | tag) of VERIFIER_PLAINTEXT */
  verifier: string;
}
