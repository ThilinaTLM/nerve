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
      amazon_bedrock_api_key: "amazon-bedrock",
      ant_ling_api_key: "ant-ling",
      anthropic_api_key: "anthropic",
      anthropic_oauth: "anthropic",
      azure_openai_responses_api_key: "azure-openai-responses",
      cerebras_api_key: "cerebras",
      cloudflare_ai_gateway_api_key: "cloudflare-ai-gateway",
      cloudflare_workers_ai_api_key: "cloudflare-workers-ai",
      deepseek_api_key: "deepseek",
      fireworks_api_key: "fireworks",
      github_copilot_oauth: "github-copilot",
      google_api_key: "google",
      google_vertex_api_key: "google-vertex",
      groq_api_key: "groq",
      huggingface_api_key: "huggingface",
      kimi_coding_api_key: "kimi-coding",
      minimax_api_key: "minimax",
      minimax_cn_api_key: "minimax-cn",
      mistral_api_key: "mistral",
      moonshotai_api_key: "moonshotai",
      moonshotai_cn_api_key: "moonshotai-cn",
      nvidia_api_key: "nvidia",
      openai_api_key: "openai",
      openai_codex_oauth: "openai-codex",
      opencode_api_key: "opencode",
      opencode_go_api_key: "opencode-go",
      openrouter_api_key: "openrouter",
      together_api_key: "together",
      vercel_ai_gateway_api_key: "vercel-ai-gateway",
      xai_api_key: "xai",
      xiaomi_api_key: "xiaomi",
      xiaomi_token_plan_ams_api_key: "xiaomi-token-plan-ams",
      xiaomi_token_plan_cn_api_key: "xiaomi-token-plan-cn",
      xiaomi_token_plan_sgp_api_key: "xiaomi-token-plan-sgp",
      zai_api_key: "zai",
      zai_coding_cn_api_key: "zai-coding-cn",
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
