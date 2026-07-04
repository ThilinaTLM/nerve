import { randomUUID } from "node:crypto";
import {
  type SandboxCredentialConfig,
  type SandboxManagerCredentialAuthType,
  type SandboxManagerCredentialProfile,
  type SandboxManagerCredentialProfileWrite,
  type SandboxManagerCredentialStatus,
  sandboxManagerCredentialProfileSchema,
} from "@nervekit/shared";
import type { PostgresPool } from "../db/postgres.js";
import type { PostgresKvSecretStore } from "../secrets/postgres-kv-secret-store.js";
import type { PostgresCredentialProfileStore } from "./credential-profile-store.js";
import {
  credentialSecretKey,
  providerForProviderKind,
} from "./credential-secret-keys.js";

export class CredentialProfileService {
  constructor(
    private readonly pool: PostgresPool,
    private readonly profiles: PostgresCredentialProfileStore,
    private readonly secrets: PostgresKvSecretStore,
  ) {}

  async create(
    request: SandboxManagerCredentialProfileWrite,
  ): Promise<SandboxManagerCredentialProfile> {
    return this.upsert(request.profileId ?? `cred_${randomUUID()}`, request);
  }

  async update(
    profileId: string,
    request: SandboxManagerCredentialProfileWrite,
  ): Promise<SandboxManagerCredentialProfile> {
    return this.upsert(profileId, request);
  }

  async delete(profileId: string): Promise<void> {
    const result = await this.pool.query<{ secret_key: string }>(
      "select secret_key from credential_profile_secrets where profile_id = $1",
      [profileId],
    );
    for (const row of result.rows) await this.secrets.delete(row.secret_key);
    await this.pool.query(
      "delete from credential_profile_secrets where profile_id = $1",
      [profileId],
    );
    await this.profiles.delete(profileId);
  }

  private async upsert(
    profileId: string,
    request: SandboxManagerCredentialProfileWrite,
  ): Promise<SandboxManagerCredentialProfile> {
    const existing = await this.profiles.get(profileId);
    const now = new Date().toISOString();
    const secretPurpose = secretPurposeForRequest(request);
    const secretKey = credentialSecretKey(profileId, secretPurpose);
    const secretValue = secretValueForRequest(request);
    const expiresAt = request.oauthImport?.expiresAt;
    if (secretValue !== undefined) {
      await this.secrets.set(secretKey, secretValue, {
        expiresAt,
        version: now,
      });
      await this.pool.query(
        `insert into credential_profile_secrets
          (profile_id, purpose, secret_key, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         on conflict (profile_id, purpose) do update set
          secret_key = excluded.secret_key,
          updated_at = now()`,
        [profileId, secretPurpose, secretKey],
      );
    }
    const configured = Boolean(secretValue !== undefined || existing);
    const profile = sandboxManagerCredentialProfileSchema.parse({
      ...(existing ?? {}),
      profileId,
      kind: request.kind,
      providerKind: request.providerKind,
      displayName: request.displayName,
      provider:
        request.provider ??
        existing?.provider ??
        providerForProviderKind(request.providerKind),
      api: request.api,
      baseUrl: request.baseUrl,
      siteUrl: request.siteUrl,
      email: request.email,
      headers: request.headers,
      compat: request.compat,
      providerOptions: request.providerOptions,
      env: request.env,
      authType: authTypeForRequest(request),
      status: statusForRequest(request, configured),
      expiresAt,
      refreshAfter: expiresAt ? refreshAfter(expiresAt) : undefined,
      secretRefs: [
        {
          purpose: secretPurpose,
          configured,
          expiresAt,
        },
      ],
      credential: credentialConfigForProfile(profileId, request, secretPurpose),
      defaultModel: request.defaultModel,
      defaultOwner: request.defaultOwner,
      defaultRepo: request.defaultRepo,
      defaultProjectKey: request.defaultProjectKey,
      defaultSpaceKey: request.defaultSpaceKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.profiles.put(profile);
    return profile;
  }
}

function secretValueForRequest(
  request: SandboxManagerCredentialProfileWrite,
): string | undefined {
  if (request.apiKey) return request.apiKey;
  if (request.bearerToken) return request.bearerToken;
  if (request.password) return request.password;
  if (request.privateKey) return request.privateKey;
  if (request.githubApp) return JSON.stringify(request.githubApp);
  if (request.oauthImport) {
    const raw =
      typeof request.oauthImport.rawBundle === "object" &&
      request.oauthImport.rawBundle !== null
        ? (request.oauthImport.rawBundle as Record<string, unknown>)
        : {};
    return JSON.stringify({ type: "oauth", ...raw, ...request.oauthImport });
  }
  return undefined;
}

function secretPurposeForRequest(
  request: SandboxManagerCredentialProfileWrite,
): string {
  if (request.oauthImport) return "oauth-bundle";
  if (request.githubApp) return "github-app";
  if (request.privateKey) return "private-key";
  if (request.password) return "password";
  if (request.bearerToken) return "bearer-token";
  return "api-key";
}

function authTypeForRequest(
  request: SandboxManagerCredentialProfileWrite,
): SandboxManagerCredentialAuthType {
  if (request.oauthImport) return "oauth";
  if (request.githubApp) return "github_app";
  if (request.privateKey) return "ssh";
  if (request.password) return "basic";
  if (request.bearerToken) return "bearer";
  return "api_key";
}

function statusForRequest(
  request: SandboxManagerCredentialProfileWrite,
  configured: boolean,
): SandboxManagerCredentialStatus {
  if (!configured) return request.oauthImport ? "needs_login" : "invalid";
  if (
    request.oauthImport?.expiresAt &&
    Date.parse(request.oauthImport.expiresAt) <= Date.now()
  )
    return "expired";
  return "configured";
}

function credentialConfigForProfile(
  profileId: string,
  request: SandboxManagerCredentialProfileWrite,
  purpose: string,
): SandboxCredentialConfig {
  const ref = { kv: { key: credentialSecretKey(profileId, purpose) } };
  if (request.privateKey) return { type: "ssh", privateKey: ref };
  if (request.password)
    return {
      type: "basic",
      username: request.username ?? request.email ?? "user",
      password: ref,
    };
  if (request.bearerToken || request.oauthImport || request.githubApp)
    return { type: "bearer", token: ref };
  return { type: "api_key", apiKey: ref };
}

function refreshAfter(expiresAt: string): string | undefined {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return undefined;
  return new Date(Math.max(Date.now(), expires - 5 * 60_000)).toISOString();
}
