import type {
  SandboxManagerCredentialProfile,
  SandboxManagerCredentialProfileKind,
  SandboxManagerCredentialProviderKind,
} from "@nervekit/shared";

export function primaryPurposeForKind(
  kind: SandboxManagerCredentialProfileKind,
): "model_api" | "github" | "jira" | "confluence" | "web" {
  if (kind === "github") return "github";
  if (kind === "jira") return "jira";
  if (kind === "confluence") return "confluence";
  if (kind === "web_provider") return "web";
  return "model_api";
}

export function providerForProviderKind(
  providerKind: SandboxManagerCredentialProviderKind,
  fallback?: string,
): string {
  const mapping: Partial<Record<SandboxManagerCredentialProviderKind, string>> =
    {
      anthropic_api_key: "anthropic",
      anthropic_oauth: "anthropic",
      openai_api_key: "openai",
      openai_codex_oauth: "openai-codex",
      google_api_key: "google",
      xai_api_key: "xai",
      openrouter_api_key: "openrouter",
      github_pat: "github.com",
      github_oauth: "github.com",
      github_app: "github.com",
      github_ssh: "github.com",
      jira_api_token: "jira",
      jira_oauth: "jira",
      confluence_api_token: "confluence",
      confluence_oauth: "confluence",
      tavily_api_key: "tavily",
    };
  return mapping[providerKind] ?? fallback ?? "custom";
}

export function credentialSecretKey(
  profileId: string,
  purpose: string,
): string {
  return `credentials/${profileId}/${purpose}`;
}

export function profileSecretKey(
  profile: Pick<SandboxManagerCredentialProfile, "profileId" | "secretRefs">,
  purpose = "primary",
): string {
  const ref = profile.secretRefs.find((entry) => entry.purpose === purpose);
  return ref
    ? credentialSecretKey(profile.profileId, ref.purpose)
    : credentialSecretKey(profile.profileId, purpose);
}

export function isCredentialSecretKey(key: string): boolean {
  return key.startsWith("credentials/");
}
