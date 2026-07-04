import type { PostgresPool } from "../db/postgres.js";
import type {
  KvSecretStore,
  ManagerSecretMetadata,
  ManagerSecretResolveRequest,
  ManagerSecretResolveResponse,
} from "./kv-secret-store.js";
import {
  decodeSecretEnvelope,
  type EncryptedSecretEnvelope,
  encodeSecretEnvelope,
  normalizeSecretKey,
  secretKeyId,
} from "./secret-encryption.js";

export type PostgresKvSecretStoreOptions = {
  mode?: "production" | "development";
  encryptionKey?: string;
  keyId?: string;
  allowCleartextSecretsInDevelopment?: boolean;
};

export class PostgresKvSecretStore implements KvSecretStore {
  private readonly mode: "production" | "development";
  private readonly key?: Buffer;
  private readonly keyId?: string;
  private readonly allowCleartext: boolean;

  constructor(
    private readonly pool: PostgresPool,
    options: PostgresKvSecretStoreOptions = {},
  ) {
    this.mode = options.mode ?? "production";
    this.key = options.encryptionKey
      ? normalizeSecretKey(options.encryptionKey)
      : undefined;
    this.keyId =
      options.keyId ?? (this.key ? secretKeyId(this.key) : undefined);
    this.allowCleartext = Boolean(
      this.mode === "development" && options.allowCleartextSecretsInDevelopment,
    );
  }

  async assertReady(): Promise<void> {
    if (this.key) return;
    if (this.mode === "production")
      throw new Error(
        "NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY is required in production",
      );
    if (!this.allowCleartext)
      throw new Error(
        "Secret encryption key is required unless development cleartext storage is explicitly enabled",
      );
  }

  async set(
    key: string,
    value: string,
    metadata: Omit<ManagerSecretResolveResponse, "value"> = {},
  ): Promise<void> {
    if (key.length > 512) throw new Error("Secret key is too long");
    if (Buffer.byteLength(value) > 1_000_000)
      throw new Error("Secret value exceeds maximum size");
    const envelope = encodeSecretEnvelope(
      value,
      metadata,
      this.key,
      this.keyId,
      this.allowCleartext,
    );
    await this.pool.query(
      `insert into manager_secrets (secret_key, envelope, metadata, created_at, updated_at)
       values ($1, $2::jsonb, $3::jsonb, now(), now())
       on conflict (secret_key) do update set
         envelope = excluded.envelope,
         metadata = excluded.metadata,
         updated_at = now()`,
      [key, JSON.stringify(envelope), JSON.stringify(metadata)],
    );
  }

  async resolve(
    request: ManagerSecretResolveRequest,
  ): Promise<ManagerSecretResolveResponse> {
    if (request.key.length > 512) throw new Error("Secret key is too long");
    const result = await this.pool.query<{
      envelope: ManagerSecretResolveResponse | EncryptedSecretEnvelope;
    }>("select envelope from manager_secrets where secret_key = $1", [
      request.key,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error(`Secret not found: ${request.key}`);
    const value = decodeSecretEnvelope(
      row.envelope,
      this.key,
      this.mode === "production",
    );
    if (request.version && value.version && request.version !== value.version)
      throw new Error("Secret version not found");
    return value;
  }

  async listMetadata(): Promise<ManagerSecretMetadata[]> {
    const result = await this.pool.query<{
      secret_key: string;
      metadata: Omit<ManagerSecretResolveResponse, "value">;
      created_at: Date;
      updated_at: Date;
    }>(
      `select secret_key, metadata, created_at, updated_at
       from manager_secrets
       order by secret_key`,
    );
    return result.rows.map((row) => ({
      key: row.secret_key,
      ...row.metadata,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async delete(key: string): Promise<void> {
    await this.pool.query("delete from manager_secrets where secret_key = $1", [
      key,
    ]);
  }
}
