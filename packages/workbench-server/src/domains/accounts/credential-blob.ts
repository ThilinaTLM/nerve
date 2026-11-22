import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * What the `account.credential` column holds once decrypted. Versioned, so a later shape can be
 * read next to this one. Only the credential vault reads or writes it.
 */
export type CredentialBlob = {
  v: 1;
  /** Typed-in secrets by name (`secret` for a kind's single one). */
  secrets: Record<string, string>;
  /** Provider state (tokens); opaque to the vault. */
  state?: unknown;
  /** Short non-secret strings the provider reported about the account (login, id). */
  identity?: Record<string, string>;
  /** The last failure, as the user sees it. */
  error?: string;
  grantedScopes?: string[];
  /** Hash of the credential code that wrote this blob. */
  codeHash?: string;
};

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * `version(1) | iv(12) | tag(16) | ciphertext`: AES-256-GCM under the master key, with the
 * account id as associated data so a blob cannot be moved to another row.
 */
export function sealCredential(
  key: Buffer,
  accountId: string,
  blob: CredentialBlob,
): Uint8Array {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(accountId, "utf8"));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(blob), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
}

/** Throws when the blob was sealed for another account, with another key, or was altered. */
export function openCredential(
  key: Buffer,
  accountId: string,
  sealed: Uint8Array,
): CredentialBlob {
  const bytes = Buffer.from(sealed);
  if (bytes[0] !== VERSION || bytes.byteLength < 1 + IV_BYTES + TAG_BYTES)
    throw new Error("Unsupported account credential format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    bytes.subarray(1, 1 + IV_BYTES),
  );
  decipher.setAAD(Buffer.from(accountId, "utf8"));
  decipher.setAuthTag(bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as CredentialBlob;
  if (parsed.v !== 1 || typeof parsed.secrets !== "object")
    throw new Error("Invalid account credential.");
  return parsed;
}
