import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../state/atomic-write.js";
import type {
  KvSecretStore,
  ManagerSecretResolveRequest,
  ManagerSecretResolveResponse,
} from "./kv-secret-store.js";

export type FileKvSecretStoreOptions = {
  mode?: "production" | "development";
  encryptionKey?: string;
  keyId?: string;
  allowCleartextSecretsInDevelopment?: boolean;
};

type EncryptedSecretEnvelope = {
  format: "nerve.secret.envelope.v1";
  alg: "AES-256-GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  metadata?: Omit<ManagerSecretResolveResponse, "value">;
};

export class FileKvSecretStore implements KvSecretStore {
  private readonly mode: "production" | "development";
  private readonly key?: Buffer;
  private readonly keyId?: string;
  private readonly allowCleartext: boolean;

  constructor(
    private readonly rootDir: string,
    options: FileKvSecretStoreOptions = {},
  ) {
    this.mode = options.mode ?? "production";
    this.key = options.encryptionKey
      ? normalizeKey(options.encryptionKey)
      : undefined;
    this.keyId = options.keyId ?? (this.key ? keyId(this.key) : undefined);
    this.allowCleartext = Boolean(
      this.mode === "development" && options.allowCleartextSecretsInDevelopment,
    );
  }

  async assertReady(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    if (this.key) return;
    const cleartext = await this.containsCleartextSecrets();
    if (this.mode === "production" && cleartext) {
      throw new Error(
        "Refusing to start with cleartext manager secrets and no encryption key",
      );
    }
  }

  async set(
    key: string,
    value: string,
    metadata: Omit<ManagerSecretResolveResponse, "value"> = {},
  ): Promise<void> {
    if (key.length > 512) throw new Error("Secret key is too long");
    if (Buffer.byteLength(value) > 1_000_000)
      throw new Error("Secret value exceeds maximum size");
    await mkdir(this.rootDir, { recursive: true });
    const file = path.join(this.rootDir, `${safe(key)}.json`);
    const payload = this.encode(value, metadata);
    await atomicWriteFile(file, `${JSON.stringify(payload, null, 2)}\n`, 0o600);
  }
  async resolve(
    request: ManagerSecretResolveRequest,
  ): Promise<ManagerSecretResolveResponse> {
    if (request.key.length > 512) throw new Error("Secret key is too long");
    const raw = await readFile(
      path.join(this.rootDir, `${safe(request.key)}.json`),
      "utf8",
    );
    const value = this.decode(
      JSON.parse(raw) as ManagerSecretResolveResponse | EncryptedSecretEnvelope,
    );
    if (request.version && value.version && request.version !== value.version)
      throw new Error("Secret version not found");
    return value;
  }

  private encode(
    value: string,
    metadata: Omit<ManagerSecretResolveResponse, "value">,
  ): ManagerSecretResolveResponse | EncryptedSecretEnvelope {
    if (!this.key) {
      if (!this.allowCleartext)
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
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      format: "nerve.secret.envelope.v1",
      alg: "AES-256-GCM",
      keyId: this.keyId ?? "local",
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: tag.toString("base64url"),
      metadata,
    };
  }

  private decode(
    stored: ManagerSecretResolveResponse | EncryptedSecretEnvelope,
  ): ManagerSecretResolveResponse {
    if (isEnvelope(stored)) {
      if (!this.key) throw new Error("Secret encryption key is required");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(stored.nonce, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
      const value = Buffer.concat([
        decipher.update(Buffer.from(stored.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return { ...(stored.metadata ?? {}), value };
    }
    if (this.mode === "production" && !this.key)
      throw new Error(
        "Cleartext manager secret cannot be resolved in production without encryption key",
      );
    return stored;
  }

  private async containsCleartextSecrets(): Promise<boolean> {
    let files: string[];
    try {
      files = await readdir(this.rootDir);
    } catch {
      return false;
    }
    for (const file of files.filter((entry) => entry.endsWith(".json"))) {
      try {
        const parsed = JSON.parse(
          await readFile(path.join(this.rootDir, file), "utf8"),
        ) as unknown;
        if (!isEnvelope(parsed)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
}
function safe(key: string): string {
  return Buffer.from(key).toString("base64url");
}

function normalizeKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(trimmed).digest();
}

function keyId(key: Buffer): string {
  return `sha256:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function isEnvelope(value: unknown): value is EncryptedSecretEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { format?: unknown }).format === "nerve.secret.envelope.v1"
  );
}
