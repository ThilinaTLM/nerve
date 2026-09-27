import type { AuthProviderMetadata } from "$lib/api";

export type ProviderDialogKind = "oauth" | "api_key" | "all";
export type ProviderAuthRoute = "method" | "oauth" | "api-key";

export function supportsDialogKind(
  provider: AuthProviderMetadata,
  kind: ProviderDialogKind,
): boolean {
  if (kind === "oauth") return provider.supportsOAuth;
  if (kind === "api_key") return provider.supportsApiKey;
  return provider.supportsOAuth || provider.supportsApiKey;
}

export function isProviderAvailableForDialog(
  provider: AuthProviderMetadata,
  kind: ProviderDialogKind,
): boolean {
  if (!supportsDialogKind(provider, kind)) return false;
  if (!provider.configured) return true;
  if (kind === "oauth") return provider.credentialType !== "oauth";
  if (kind === "api_key") return provider.credentialType !== "api_key";
  return false;
}

export function routeProviderAuth(
  provider: AuthProviderMetadata,
  kind: ProviderDialogKind,
): ProviderAuthRoute {
  if (kind === "oauth") return "oauth";
  if (kind === "api_key") return "api-key";
  if (provider.supportsOAuth && provider.supportsApiKey) return "method";
  return provider.supportsOAuth ? "oauth" : "api-key";
}

export function deviceCodeSecondsRemaining(
  expiresAt: string | undefined,
  now: number,
): number | undefined {
  if (!expiresAt) return undefined;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return undefined;
  return Math.max(0, Math.ceil((expiry - now) / 1_000));
}
