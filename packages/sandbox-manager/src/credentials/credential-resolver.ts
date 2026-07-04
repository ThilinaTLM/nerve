import { createSign } from "node:crypto";
import {
  getOAuthApiKey,
  type OAuthCredentials,
} from "@earendil-works/pi-ai/oauth";
import type { ManagerCredentialResolveResponse } from "@nervekit/shared";
import type { PostgresPool } from "../db/postgres.js";
import type { PostgresKvSecretStore } from "../secrets/postgres-kv-secret-store.js";
import type { PostgresCredentialProfileStore } from "./credential-profile-store.js";
import { isCredentialSecretKey } from "./credential-secret-keys.js";

const DEFAULT_MIN_TTL_MS = 5 * 60_000;

type ProfileSecretRow = {
  profile_id: string;
  purpose: string;
  secret_key: string;
};

type OAuthBundle = OAuthCredentials & {
  type?: "oauth";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  expires?: number;
};

export class CredentialResolver {
  private readonly refreshLocks = new Map<
    string,
    Promise<ManagerCredentialResolveResponse>
  >();

  constructor(
    private readonly pool: PostgresPool,
    private readonly profiles: PostgresCredentialProfileStore,
    private readonly secrets: PostgresKvSecretStore,
  ) {}

  async resolveKey(
    key: string,
    options: { minTtlMs?: number } = {},
  ): Promise<ManagerCredentialResolveResponse | undefined> {
    if (!isCredentialSecretKey(key)) return undefined;
    const row = await this.profileSecretForKey(key);
    if (!row) return undefined;
    return this.resolveProfile(row.profile_id, row.purpose, options);
  }

  async resolveProfile(
    profileId: string,
    purpose?: string,
    options: { minTtlMs?: number } = {},
  ): Promise<ManagerCredentialResolveResponse> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new Error("Credential profile not found");
    const secret = await this.profileSecret(profileId, purpose);
    if (!secret) throw new Error("Credential profile secret not found");
    if (profile.authType === "github_app") {
      return this.resolveGitHubApp(profileId, secret.secret_key, options);
    }
    if (profile.authType === "oauth") {
      const existing = this.refreshLocks.get(profileId);
      if (existing) return existing;
      const pending = this.resolveOAuth(
        profileId,
        secret.secret_key,
        options,
      ).finally(() => this.refreshLocks.delete(profileId));
      this.refreshLocks.set(profileId, pending);
      return pending;
    }
    const resolved = await this.secrets.resolve({ key: secret.secret_key });
    return {
      value: resolved.value,
      credentialType:
        profile.authType === "ssh"
          ? "ssh_private_key"
          : profile.authType === "bearer"
            ? "bearer"
            : profile.authType === "basic"
              ? "basic_password"
              : "api_key",
      expiresAt: resolved.expiresAt,
      cacheTtlMs: cacheTtlMs(resolved.expiresAt, options.minTtlMs),
      metadata: {
        profileId,
        providerKind: profile.providerKind,
        authType: profile.authType,
      },
    };
  }

  private async resolveOAuth(
    profileId: string,
    secretKey: string,
    options: { minTtlMs?: number },
  ): Promise<ManagerCredentialResolveResponse> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new Error("Credential profile not found");
    const startedAt = new Date().toISOString();
    const bundle = parseOAuthBundle(
      (await this.secrets.resolve({ key: secretKey })).value,
    );
    let current = bundle;
    let status = "skipped";
    let error: unknown;
    try {
      if (needsRefresh(bundle, options.minTtlMs ?? DEFAULT_MIN_TTL_MS)) {
        status = "refreshing";
        const refreshed = await refreshOAuth(
          profile.provider ?? profile.providerKind,
          bundle,
        );
        if (refreshed) {
          current = refreshed.newCredentials as OAuthBundle;
          const expiresAt = expiresAtForBundle(current);
          await this.secrets.set(
            secretKey,
            JSON.stringify({ type: "oauth", ...current }),
            {
              expiresAt,
              version: new Date().toISOString(),
            },
          );
          await this.profiles.put({
            ...profile,
            status: "configured",
            expiresAt,
            refreshAfter: refreshAfter(expiresAt),
            lastRefreshAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          await this.recordRefresh(
            profileId,
            profile.providerKind,
            "refreshed",
            startedAt,
            expiresAt,
          );
          return {
            value: refreshed.apiKey,
            credentialType: "bearer",
            expiresAt,
            refreshAfter: refreshAfter(expiresAt),
            cacheTtlMs: cacheTtlMs(expiresAt, options.minTtlMs),
            metadata: {
              profileId,
              providerKind: profile.providerKind,
              authType: "oauth",
            },
          };
        }
      }
      status = "unchanged";
      const value = oauthAccessValue(current);
      const expiresAt = expiresAtForBundle(current);
      await this.recordRefresh(
        profileId,
        profile.providerKind,
        status,
        startedAt,
        expiresAt,
      );
      return {
        value,
        credentialType: "bearer",
        expiresAt,
        refreshAfter: refreshAfter(expiresAt),
        cacheTtlMs: cacheTtlMs(expiresAt, options.minTtlMs),
        metadata: {
          profileId,
          providerKind: profile.providerKind,
          authType: "oauth",
        },
      };
    } catch (refreshError) {
      error = refreshError;
      await this.profiles.put({
        ...profile,
        status: "invalid",
        lastError: {
          code: "OAUTH_REFRESH_FAILED",
          message:
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError),
        },
        updatedAt: new Date().toISOString(),
      });
      await this.recordRefresh(
        profileId,
        profile.providerKind,
        "failed",
        startedAt,
        undefined,
        error,
      );
      throw refreshError;
    }
  }

  private async resolveGitHubApp(
    profileId: string,
    secretKey: string,
    options: { minTtlMs?: number },
  ): Promise<ManagerCredentialResolveResponse> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new Error("Credential profile not found");
    const raw = (await this.secrets.resolve({ key: secretKey })).value;
    const app = JSON.parse(raw) as {
      appId: string;
      installationId: string;
      privateKey: string;
    };
    const jwt = signGitHubAppJwt(app.appId, app.privateKey);
    const response = await fetch(
      `https://api.github.com/app/installations/${encodeURIComponent(
        app.installationId,
      )}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "user-agent": "nerve-sandbox-manager",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!response.ok)
      throw new Error(`GitHub App token request failed: ${response.status}`);
    const body = (await response.json()) as {
      token?: string;
      expires_at?: string;
    };
    if (!body.token)
      throw new Error("GitHub App response did not include token");
    return {
      value: body.token,
      credentialType: "bearer",
      expiresAt: body.expires_at,
      refreshAfter: refreshAfter(body.expires_at),
      cacheTtlMs: cacheTtlMs(body.expires_at, options.minTtlMs),
      metadata: {
        profileId,
        providerKind: profile.providerKind,
        authType: "github_app",
      },
    };
  }

  private async profileSecretForKey(
    key: string,
  ): Promise<ProfileSecretRow | undefined> {
    const result = await this.pool.query<ProfileSecretRow>(
      "select profile_id, purpose, secret_key from credential_profile_secrets where secret_key = $1",
      [key],
    );
    return result.rows[0];
  }

  private async profileSecret(
    profileId: string,
    purpose?: string,
  ): Promise<ProfileSecretRow | undefined> {
    const result = purpose
      ? await this.pool.query<ProfileSecretRow>(
          "select profile_id, purpose, secret_key from credential_profile_secrets where profile_id = $1 and purpose = $2",
          [profileId, purpose],
        )
      : await this.pool.query<ProfileSecretRow>(
          "select profile_id, purpose, secret_key from credential_profile_secrets where profile_id = $1 order by purpose limit 1",
          [profileId],
        );
    return result.rows[0];
  }

  private async recordRefresh(
    profileId: string,
    providerKind: string,
    status: string,
    startedAt: string,
    expiresAt?: string,
    error?: unknown,
  ): Promise<void> {
    await this.pool.query(
      `insert into credential_refresh_records
        (profile_id, provider_kind, status, started_at, completed_at, expires_at, error)
       values ($1, $2, $3, $4, now(), $5, $6::jsonb)`,
      [
        profileId,
        providerKind,
        status,
        startedAt,
        expiresAt ?? null,
        error
          ? JSON.stringify({
              code: error instanceof Error ? error.name : "ERROR",
              message: error instanceof Error ? error.message : String(error),
            })
          : null,
      ],
    );
  }
}

function signGitHubAppJwt(appId: string, privateKey: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function parseOAuthBundle(value: string): OAuthBundle {
  return JSON.parse(value) as OAuthBundle;
}

async function refreshOAuth(
  provider: string,
  bundle: OAuthBundle,
): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | undefined> {
  if (!bundle.refreshToken && !bundle.refresh_token && !bundle.refresh)
    return undefined;
  const result = await getOAuthApiKey(provider, {
    [provider]: bundle as OAuthCredentials,
  });
  return result ?? undefined;
}

function needsRefresh(bundle: OAuthBundle, minTtlMs: number): boolean {
  const expires = expiresTime(bundle);
  if (!expires) return false;
  return expires - Date.now() <= minTtlMs;
}

function oauthAccessValue(bundle: OAuthBundle): string {
  const value = bundle.accessToken ?? bundle.access_token ?? bundle.access;
  if (typeof value === "string") return value;
  throw new Error("OAuth credential has no access token");
}

function expiresAtForBundle(bundle: OAuthBundle): string | undefined {
  const expires = expiresTime(bundle);
  return expires ? new Date(expires).toISOString() : bundle.expiresAt;
}

function expiresTime(bundle: OAuthBundle): number | undefined {
  if (bundle.expiresAt) return Date.parse(bundle.expiresAt);
  if (typeof bundle.expires === "number") return bundle.expires;
  return undefined;
}

function refreshAfter(expiresAt: string | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return undefined;
  return new Date(
    Math.max(Date.now(), expires - DEFAULT_MIN_TTL_MS),
  ).toISOString();
}

function cacheTtlMs(
  expiresAt: string | undefined,
  minTtlMs = DEFAULT_MIN_TTL_MS,
): number | undefined {
  if (!expiresAt) return undefined;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return undefined;
  return Math.max(0, expires - Date.now() - minTtlMs);
}
