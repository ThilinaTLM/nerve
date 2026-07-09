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
import { dbTables } from "../db/tables.js";
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
      `select secret_key from ${dbTables.credentialProfileSecrets} where profile_id = $1`,
      [profileId],
    );
    for (const row of result.rows) await this.secrets.delete(row.secret_key);
    await this.pool.query(
      `delete from ${dbTables.credentialProfileSecrets} where profile_id = $1`,
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
    const secretInputs = secretInputsForRequest(request);
    const expiresAt = request.oauthImport?.expiresAt;
    for (const input of secretInputs) {
      const secretKey = credentialSecretKey(profileId, input.purpose);
      await this.secrets.set(secretKey, input.value, {
        expiresAt: input.expiresAt,
        version: now,
      });
      await this.pool.query(
        `insert into ${dbTables.credentialProfileSecrets}
          (profile_id, purpose, secret_key, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         on conflict (profile_id, purpose) do update set
          secret_key = excluded.secret_key,
          updated_at = now()`,
        [profileId, input.purpose, secretKey],
      );
    }
    const configured = Boolean(
      request.providerKind === "git_identity" ||
        secretInputs.length > 0 ||
        existing,
    );
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
      gitAuthorName: request.gitAuthorName,
      gitAuthorEmail: request.gitAuthorEmail,
      authType: authTypeForRequest(request),
      status: statusForRequest(request, configured),
      expiresAt,
      refreshAfter: expiresAt ? refreshAfter(expiresAt) : undefined,
      secretRefs: secretRefSummaries(
        request,
        secretPurpose,
        configured,
        expiresAt,
        existing?.secretRefs,
      ),
      credential:
        credentialConfigForProfile(profileId, request, secretPurpose) ??
        existing?.credential,
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

function secretInputsForRequest(
  request: SandboxManagerCredentialProfileWrite,
): Array<{ purpose: string; value: string; expiresAt?: string }> {
  const expiresAt = request.oauthImport?.expiresAt;
  const inputs: Array<{ purpose: string; value: string; expiresAt?: string }> =
    [];
  if (request.apiKey)
    inputs.push({ purpose: "api-key", value: request.apiKey, expiresAt });
  if (request.bearerToken)
    inputs.push({
      purpose: "bearer-token",
      value: request.bearerToken,
      expiresAt,
    });
  if (request.password)
    inputs.push({ purpose: "password", value: request.password, expiresAt });
  if (request.privateKey)
    inputs.push({
      purpose: "private-key",
      value: request.privateKey,
      expiresAt,
    });
  if (request.passphrase)
    inputs.push({
      purpose: "passphrase",
      value: request.passphrase,
      expiresAt,
    });
  if (request.knownHosts)
    inputs.push({
      purpose: "known-hosts",
      value: request.knownHosts,
      expiresAt,
    });
  if (request.githubApp)
    inputs.push({
      purpose: "github-app",
      value: JSON.stringify(request.githubApp),
      expiresAt,
    });
  if (request.oauthImport) {
    const raw =
      typeof request.oauthImport.rawBundle === "object" &&
      request.oauthImport.rawBundle !== null
        ? (request.oauthImport.rawBundle as Record<string, unknown>)
        : {};
    inputs.push({
      purpose: "oauth-bundle",
      value: JSON.stringify({ type: "oauth", ...raw, ...request.oauthImport }),
      expiresAt,
    });
  }
  return inputs;
}

function secretRefSummaries(
  request: SandboxManagerCredentialProfileWrite,
  primaryPurpose: string,
  configured: boolean,
  expiresAt: string | undefined,
  existing: Array<{
    purpose: string;
    configured: boolean;
    expiresAt?: string;
  }> = [],
): Array<{ purpose: string; configured: boolean; expiresAt?: string }> {
  const purposes = new Set(
    secretInputsForRequest(request).map((input) => input.purpose),
  );
  if (purposes.size === 0 && existing.length > 0)
    for (const ref of existing) purposes.add(ref.purpose);
  if (purposes.size === 0 && request.providerKind !== "git_identity")
    purposes.add(primaryPurpose);
  return Array.from(purposes).map((purpose) => ({
    purpose,
    configured,
    expiresAt,
  }));
}

function secretPurposeForRequest(
  request: SandboxManagerCredentialProfileWrite,
): string {
  if (request.oauthImport) return "oauth-bundle";
  if (request.githubApp) return "github-app";
  if (request.privateKey) return "private-key";
  if (request.password) return "password";
  if (request.bearerToken) return "bearer-token";
  if (request.providerKind === "git_identity") return "identity";
  return "api-key";
}

function authTypeForRequest(
  request: SandboxManagerCredentialProfileWrite,
): SandboxManagerCredentialAuthType {
  if (request.providerKind === "git_identity") return "none";
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
): SandboxCredentialConfig | undefined {
  const ref = { kv: { key: credentialSecretKey(profileId, purpose) } };
  if (request.providerKind === "git_identity") return undefined;
  if (request.privateKey)
    return {
      type: "ssh",
      privateKey: ref,
      ...(request.passphrase
        ? {
            passphrase: {
              kv: { key: credentialSecretKey(profileId, "passphrase") },
            },
          }
        : {}),
      ...(request.knownHosts
        ? {
            knownHosts: {
              kv: { key: credentialSecretKey(profileId, "known-hosts") },
            },
          }
        : {}),
    };
  if (request.password)
    return {
      type: "basic",
      username: request.username ?? request.email ?? "user",
      password: ref,
    };
  if (request.bearerToken || request.oauthImport || request.githubApp)
    return { type: "bearer", token: ref };
  if (request.apiKey) return { type: "api_key", apiKey: ref };
  return undefined;
}

function refreshAfter(expiresAt: string): string | undefined {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return undefined;
  return new Date(Math.max(Date.now(), expires - 5 * 60_000)).toISOString();
}
