export type OAuthBundle = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  [key: string]: unknown;
};
export type OAuthRefreshResult = {
  status: "refreshed" | "unchanged" | "failed" | "skipped";
  bundle: OAuthBundle;
  error?: string;
};
export async function refreshOAuthBundle(
  bundle: OAuthBundle,
  refresh: () => Promise<OAuthBundle> = async () => bundle,
): Promise<OAuthRefreshResult> {
  try {
    if (!bundle.refreshToken) return { status: "skipped", bundle };
    if (bundle.expiresAt && Date.parse(bundle.expiresAt) - Date.now() > 60_000)
      return { status: "unchanged", bundle };
    return { status: "refreshed", bundle: await refresh() };
  } catch (error) {
    return {
      status: "failed",
      bundle,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
