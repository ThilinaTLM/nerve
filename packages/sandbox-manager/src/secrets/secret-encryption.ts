import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { ManagerSecretResolveResponse } from "./kv-secret-store.js";

export type EncryptedSecretEnvelope = {
  format: "nerve.secret.envelope.v1";
  alg: "AES-256-GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  metadata?: Omit<ManagerSecretResolveResponse, "value">;
};

export function encodeSecretEnvelope(
  value: string,
  metadata: Omit<ManagerSecretResolveResponse, "value">,
  key: Buffer | undefined,
  keyId: string | undefined,
  allowCleartext: boolean,
): ManagerSecretResolveResponse | EncryptedSecretEnvelope {
  if (!key) {
    if (!allowCleartext)
      throw new Error(
        "Secret encryption key is required for manager secret writes",
      );
    return {
      ...metadata,
      value,
      cleartextWarning:
        "development mode cleartext secret storage is explicitly enabled",
    } as ManagerSecretResolveResponse;
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    format: "nerve.secret.envelope.v1",
    alg: "AES-256-GCM",
    keyId: keyId ?? "local",
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
    metadata,
  };
}

export function decodeSecretEnvelope(
  stored: ManagerSecretResolveResponse | EncryptedSecretEnvelope,
  key: Buffer | undefined,
  production: boolean,
): ManagerSecretResolveResponse {
  if (isEnvelope(stored)) {
    if (!key) throw new Error("Secret encryption key is required");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(stored.nonce, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
    const value = Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return { ...(stored.metadata ?? {}), value };
  }
  if (production && !key)
    throw new Error(
      "Cleartext manager secret cannot be resolved in production without encryption key",
    );
  return stored;
}

export function normalizeSecretKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(trimmed).digest();
}

export function secretKeyId(key: Buffer): string {
  return `sha256:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function isEnvelope(value: unknown): value is EncryptedSecretEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { format?: unknown }).format === "nerve.secret.envelope.v1"
  );
}
