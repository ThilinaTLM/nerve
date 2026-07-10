import {
  BrainCircuit,
  Cloud,
  GitBranch,
  KeyRound,
  Palette,
  Search,
  Settings2,
} from "@lucide/svelte";
import type {
  SandboxManagerCredentialProfileKind,
  SandboxManagerCredentialProviderKind,
} from "@nervekit/contracts";

export type SettingsSectionId =
  | "llm_subscriptions"
  | "llm_api_keys"
  | "git_identity"
  | "git_https_token"
  | "git_ssh_key"
  | "github"
  | "jira"
  | "confluence"
  | "web_search";

export type ProviderOption = {
  providerKind: SandboxManagerCredentialProviderKind;
  label: string;
  detail: string;
  kind: SandboxManagerCredentialProfileKind;
  provider: string;
  secretMode: "none" | "apiKey" | "oauth" | "githubApp" | "privateKey";
  api?: string;
  baseUrl?: string;
  defaultModel?: string;
  envTemplate?: Record<string, string>;
  headersTemplate?: Record<string, string>;
  compatTemplate?: Record<string, unknown>;
  providerOptionsTemplate?: Record<string, unknown>;
  site?: boolean;
  email?: boolean;
  githubDefaults?: boolean;
  jiraDefaults?: boolean;
  confluenceDefaults?: boolean;
  multiline?: boolean;
};

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  /** Optional compact label for places that need shorter section text. */
  tabLabel?: string;
  description: string;
  icon: typeof BrainCircuit;
  options: ProviderOption[];
  emptyHint?: string;
};

export type SettingsDomainId =
  | "models"
  | "source_control"
  | "atlassian"
  | "web_search"
  | "appearance";

export type SettingsDomain = {
  id: SettingsDomainId;
  label: string;
  description: string;
  icon: typeof BrainCircuit;
  /** Section ids stacked under this domain. */
  sectionIds: SettingsSectionId[];
  /** Non-provider domains render a custom panel instead of sections. */
  custom?: "appearance";
};

const llmSubscriptions: ProviderOption[] = [
  oauthProvider(
    "anthropic_oauth",
    "Anthropic subscription",
    "anthropic",
    "Import a Claude Pro/Max OAuth bundle.",
    "claude-sonnet-4-5",
  ),
  oauthProvider(
    "openai_codex_oauth",
    "OpenAI Codex subscription",
    "openai-codex",
    "Import a ChatGPT Plus/Pro OAuth bundle for Codex models.",
    "gpt-5.1-codex-max",
  ),
  oauthProvider(
    "github_copilot_oauth",
    "GitHub Copilot subscription",
    "github-copilot",
    "Import a GitHub Copilot OAuth bundle for Copilot-backed models.",
    "gpt-5.1-codex-max",
  ),
];

const llmApiKeys: ProviderOption[] = [
  apiProvider(
    "amazon_bedrock_api_key",
    "Amazon Bedrock",
    "amazon-bedrock",
    "AWS Bedrock Converse models. Add AWS region/config in provider env when needed.",
    "anthropic.claude-sonnet-4-5-20250929-v1:0",
    {
      envTemplate: {
        AWS_REGION: "us-east-1",
      },
    },
  ),
  apiProvider(
    "ant_ling_api_key",
    "Ant Ling",
    "ant-ling",
    "Ant Ling OpenAI-compatible API.",
    "gpt-5",
  ),
  apiProvider(
    "anthropic_api_key",
    "Anthropic API key",
    "anthropic",
    "Claude API key.",
    "claude-sonnet-4-5",
  ),
  apiProvider(
    "azure_openai_responses_api_key",
    "Azure OpenAI Responses",
    "azure-openai-responses",
    "Azure OpenAI Responses API. Configure resource/deployment details in base URL and provider env.",
    "gpt-5",
    {
      baseUrl: "https://example.openai.azure.com/openai/v1",
      envTemplate: {
        AZURE_OPENAI_API_VERSION: "v1",
        AZURE_OPENAI_DEPLOYMENT_NAME_MAP: '{"gpt-5":"deployment-name"}',
      },
    },
  ),
  apiProvider(
    "cerebras_api_key",
    "Cerebras",
    "cerebras",
    "Cerebras OpenAI-compatible API.",
    "qwen-3-coder-480b",
  ),
  apiProvider(
    "cloudflare_ai_gateway_api_key",
    "Cloudflare AI Gateway",
    "cloudflare-ai-gateway",
    "Cloudflare AI Gateway for Anthropic-compatible routing. Account and gateway IDs are provider env.",
    "claude-sonnet-4-5",
    {
      envTemplate: {
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_GATEWAY_ID: "gateway-id",
      },
    },
  ),
  apiProvider(
    "cloudflare_workers_ai_api_key",
    "Cloudflare Workers AI",
    "cloudflare-workers-ai",
    "Workers AI OpenAI-compatible endpoint. Account ID is provider env.",
    "@cf/meta/llama-3.1-8b-instruct",
    {
      envTemplate: {
        CLOUDFLARE_ACCOUNT_ID: "account-id",
      },
    },
  ),
  apiProvider(
    "deepseek_api_key",
    "DeepSeek",
    "deepseek",
    "DeepSeek OpenAI-compatible API.",
    "deepseek-chat",
  ),
  apiProvider(
    "fireworks_api_key",
    "Fireworks",
    "fireworks",
    "Fireworks Anthropic-compatible API.",
    "accounts/fireworks/models/kimi-k2-instruct",
  ),
  apiProvider(
    "google_api_key",
    "Google Gemini",
    "google",
    "Gemini API key.",
    "gemini-2.5-flash",
  ),
  apiProvider(
    "google_vertex_api_key",
    "Google Vertex AI",
    "google-vertex",
    "Vertex AI Gemini via API key or Google Cloud configuration. Project/location are provider env.",
    "gemini-2.5-flash",
    {
      envTemplate: {
        GOOGLE_CLOUD_PROJECT: "project-id",
        GOOGLE_CLOUD_LOCATION: "us-central1",
      },
    },
  ),
  apiProvider(
    "groq_api_key",
    "Groq",
    "groq",
    "Groq OpenAI-compatible API.",
    "openai/gpt-oss-120b",
  ),
  apiProvider(
    "huggingface_api_key",
    "Hugging Face Router",
    "huggingface",
    "Hugging Face router OpenAI-compatible API.",
    "openai/gpt-oss-120b",
  ),
  apiProvider(
    "kimi_coding_api_key",
    "Kimi For Coding",
    "kimi-coding",
    "Moonshot Kimi coding plan API.",
    "kimi-k2-0711-preview",
  ),
  apiProvider(
    "minimax_api_key",
    "MiniMax",
    "minimax",
    "MiniMax Anthropic-compatible API.",
    "MiniMax-M2",
  ),
  apiProvider(
    "minimax_cn_api_key",
    "MiniMax China",
    "minimax-cn",
    "MiniMax China Anthropic-compatible API.",
    "MiniMax-M2",
  ),
  apiProvider(
    "mistral_api_key",
    "Mistral",
    "mistral",
    "Mistral Conversations API.",
    "codestral-latest",
  ),
  apiProvider(
    "moonshotai_api_key",
    "Moonshot AI",
    "moonshotai",
    "Moonshot OpenAI-compatible API.",
    "kimi-k2-0711-preview",
  ),
  apiProvider(
    "moonshotai_cn_api_key",
    "Moonshot AI China",
    "moonshotai-cn",
    "Moonshot China OpenAI-compatible API.",
    "kimi-k2-0711-preview",
  ),
  apiProvider(
    "nvidia_api_key",
    "NVIDIA NIM",
    "nvidia",
    "NVIDIA NIM OpenAI-compatible API.",
    "openai/gpt-oss-120b",
  ),
  apiProvider(
    "openai_api_key",
    "OpenAI API key",
    "openai",
    "OpenAI Responses API key.",
    "gpt-5.1",
  ),
  apiProvider(
    "opencode_api_key",
    "OpenCode Zen",
    "opencode",
    "OpenCode Zen OpenAI-compatible API.",
    "openai/gpt-5.1",
  ),
  apiProvider(
    "opencode_go_api_key",
    "OpenCode Go",
    "opencode-go",
    "OpenCode Go OpenAI-compatible API.",
    "openai/gpt-5.1",
  ),
  apiProvider(
    "openrouter_api_key",
    "OpenRouter",
    "openrouter",
    "OpenRouter routing key.",
    "anthropic/claude-sonnet-4.5",
  ),
  apiProvider(
    "together_api_key",
    "Together AI",
    "together",
    "Together AI OpenAI-compatible API.",
    "openai/gpt-oss-120b",
  ),
  apiProvider(
    "vercel_ai_gateway_api_key",
    "Vercel AI Gateway",
    "vercel-ai-gateway",
    "Vercel AI Gateway. Optional routing can be supplied in provider options.",
    "anthropic/claude-sonnet-4.5",
    {
      providerOptionsTemplate: {
        routing: {
          order: [],
        },
      },
    },
  ),
  apiProvider(
    "xai_api_key",
    "xAI",
    "xai",
    "xAI Grok API key.",
    "grok-code-fast-1",
  ),
  apiProvider(
    "xiaomi_api_key",
    "Xiaomi MiMo",
    "xiaomi",
    "Xiaomi MiMo API billing endpoint.",
    "mimo-v2.3",
  ),
  apiProvider(
    "xiaomi_token_plan_ams_api_key",
    "Xiaomi MiMo Token Plan Amsterdam",
    "xiaomi-token-plan-ams",
    "Xiaomi MiMo token plan endpoint for Amsterdam.",
    "mimo-v2.3",
  ),
  apiProvider(
    "xiaomi_token_plan_cn_api_key",
    "Xiaomi MiMo Token Plan China",
    "xiaomi-token-plan-cn",
    "Xiaomi MiMo token plan endpoint for China.",
    "mimo-v2.3",
  ),
  apiProvider(
    "xiaomi_token_plan_sgp_api_key",
    "Xiaomi MiMo Token Plan Singapore",
    "xiaomi-token-plan-sgp",
    "Xiaomi MiMo token plan endpoint for Singapore.",
    "mimo-v2.3",
  ),
  apiProvider("zai_api_key", "ZAI", "zai", "ZAI coding API.", "glm-4.6"),
  apiProvider(
    "zai_coding_cn_api_key",
    "ZAI Coding Plan China",
    "zai-coding-cn",
    "ZAI Coding Plan China API.",
    "glm-4.6",
  ),
  {
    ...apiProvider(
      "custom_api_key",
      "Custom API key",
      "custom",
      "Any OpenAI-compatible or custom pi-ai endpoint.",
      "model-id",
    ),
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:11434/v1",
  },
];

export const sections: SettingsSection[] = [
  {
    id: "llm_subscriptions",
    label: "LLM subscriptions",
    tabLabel: "Subscriptions",
    description:
      "OAuth/subscription credentials that the manager can refresh before a sandbox needs them.",
    icon: BrainCircuit,
    options: llmSubscriptions,
  },
  {
    id: "llm_api_keys",
    label: "LLM API keys",
    tabLabel: "API keys",
    description:
      "Write-only model provider keys for every pi-ai LLM provider plus custom endpoints.",
    icon: KeyRound,
    options: llmApiKeys,
  },
  {
    id: "git_identity",
    label: "Git author identity",
    description:
      "Sandbox commit author name and email (`user.name` / `user.email`).",
    icon: Settings2,
    options: [
      {
        providerKind: "git_identity",
        label: "Git author identity",
        detail: "Global Git user.name and user.email for sandbox commits.",
        kind: "git",
        provider: "git",
        secretMode: "none",
        email: true,
      },
    ],
  },
  {
    id: "git_https_token",
    label: "Git HTTPS token",
    description:
      "Token profile for HTTPS clone, fetch, and push through a scoped Git credential helper.",
    icon: KeyRound,
    options: [
      {
        providerKind: "git_https_token",
        label: "Git HTTPS token",
        detail:
          "Token used for HTTPS clone/fetch/push via a scoped Git credential helper.",
        kind: "git",
        provider: "git",
        secretMode: "apiKey",
      },
    ],
  },
  {
    id: "git_ssh_key",
    label: "Git SSH key",
    description:
      "SSH key profile for clone, fetch, and push through an isolated SSH config.",
    icon: GitBranch,
    options: [
      {
        providerKind: "git_ssh_key",
        label: "Git SSH key",
        detail:
          "Private key used for SSH clone/fetch/push via an isolated SSH config.",
        kind: "git",
        provider: "git",
        secretMode: "privateKey",
        multiline: true,
      },
    ],
  },
  {
    id: "github",
    label: "GitHub",
    description:
      "GitHub tokens, app installations, and repository defaults for sandbox setup.",
    icon: GitBranch,
    options: [
      {
        providerKind: "github_pat",
        label: "GitHub personal access token",
        detail: "Classic or fine-grained token. Rotate manually.",
        kind: "github",
        provider: "github.com",
        secretMode: "apiKey",
        githubDefaults: true,
      },
      {
        providerKind: "github_app",
        label: "GitHub App installation",
        detail:
          "App ID, installation ID, and private key. Manager mints short-lived installation tokens.",
        kind: "github",
        provider: "github.com",
        secretMode: "githubApp",
        githubDefaults: true,
        multiline: true,
      },
      {
        providerKind: "github_ssh",
        label: "GitHub SSH key",
        detail: "Private key for Git over SSH.",
        kind: "github",
        provider: "github.com",
        secretMode: "privateKey",
        githubDefaults: true,
        multiline: true,
      },
      {
        providerKind: "github_oauth",
        label: "GitHub OAuth bundle",
        detail: "Import an OAuth bundle when issued outside this UI.",
        kind: "github",
        provider: "github.com",
        secretMode: "oauth",
        githubDefaults: true,
        multiline: true,
      },
    ],
  },
  {
    id: "jira",
    label: "Jira",
    description: "Atlassian Jira credentials and default project selection.",
    icon: Cloud,
    options: [
      {
        providerKind: "jira_api_token",
        label: "Jira API token",
        detail: "Email plus API token for an Atlassian site.",
        kind: "jira",
        provider: "jira",
        secretMode: "apiKey",
        site: true,
        email: true,
        jiraDefaults: true,
      },
      {
        providerKind: "jira_oauth",
        label: "Jira OAuth bundle",
        detail: "Import a Jira OAuth bundle for refreshable access.",
        kind: "jira",
        provider: "jira",
        secretMode: "oauth",
        site: true,
        email: true,
        jiraDefaults: true,
        multiline: true,
      },
    ],
  },
  {
    id: "confluence",
    label: "Confluence",
    description:
      "Atlassian Confluence credentials and default space selection.",
    icon: Cloud,
    options: [
      {
        providerKind: "confluence_api_token",
        label: "Confluence API token",
        detail: "Email plus API token for an Atlassian site.",
        kind: "confluence",
        provider: "confluence",
        secretMode: "apiKey",
        site: true,
        email: true,
        confluenceDefaults: true,
      },
      {
        providerKind: "confluence_oauth",
        label: "Confluence OAuth bundle",
        detail: "Import a Confluence OAuth bundle for refreshable access.",
        kind: "confluence",
        provider: "confluence",
        secretMode: "oauth",
        site: true,
        email: true,
        confluenceDefaults: true,
        multiline: true,
      },
    ],
  },
  {
    id: "web_search",
    label: "Web search",
    description: "Search provider credentials for tools that need web context.",
    icon: Search,
    options: [
      {
        providerKind: "tavily_api_key",
        label: "Tavily API key",
        detail: "Tavily search API key.",
        kind: "web_provider",
        provider: "tavily",
        secretMode: "apiKey",
      },
    ],
  },
];

function apiProvider(
  providerKind: SandboxManagerCredentialProviderKind,
  label: string,
  provider: string,
  detail: string,
  defaultModel: string,
  extras: Partial<ProviderOption> = {},
): ProviderOption {
  return {
    providerKind,
    label,
    detail,
    kind: "model_provider",
    provider,
    secretMode: "apiKey",
    defaultModel,
    ...extras,
  };
}

function oauthProvider(
  providerKind: SandboxManagerCredentialProviderKind,
  label: string,
  provider: string,
  detail: string,
  defaultModel: string,
): ProviderOption {
  return {
    providerKind,
    label,
    detail,
    kind: "model_provider",
    provider,
    secretMode: "oauth",
    defaultModel,
    multiline: true,
  };
}

/** Top-level settings domains shown in the nav. */
export const domains: SettingsDomain[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "How the sandbox manager looks on this device.",
    icon: Palette,
    sectionIds: [],
    custom: "appearance",
  },
  {
    id: "models",
    label: "Providers",
    description:
      "LLM provider credentials the manager injects into sandboxes. Subscriptions can be auto-refreshed; API keys are write-only.",
    icon: BrainCircuit,
    sectionIds: ["llm_subscriptions", "llm_api_keys"],
  },
  {
    id: "source_control",
    label: "Source control",
    description:
      "Git identity, Git authentication profiles, and GitHub access used when a sandbox clones or pushes.",
    icon: GitBranch,
    sectionIds: ["git_identity", "git_https_token", "git_ssh_key", "github"],
  },
  {
    id: "atlassian",
    label: "Atlassian",
    description:
      "Jira and Confluence credentials plus default project/space selection.",
    icon: Cloud,
    sectionIds: ["jira", "confluence"],
  },
  {
    id: "web_search",
    label: "Web search",
    description: "Search provider credentials for tools that need web context.",
    icon: Search,
    sectionIds: ["web_search"],
  },
];

export function sectionsForDomain(domain: SettingsDomain): SettingsSection[] {
  return domain.sectionIds
    .map((id) => sections.find((section) => section.id === id))
    .filter((section): section is SettingsSection => Boolean(section));
}

export function domainForSectionId(
  sectionId: SettingsSectionId,
): SettingsDomainId {
  return (
    domains.find((domain) => domain.sectionIds.includes(sectionId))?.id ??
    "appearance"
  );
}

/** Resolve a URL settings segment (domain id or legacy section id) to a domain. */
export function resolveDomainId(segment: string | undefined): SettingsDomainId {
  if (!segment) return "appearance";
  const normalized = segment.replace(/-/g, "_");
  if (normalized === "git") return "source_control";
  const direct = domains.find((domain) => domain.id === normalized);
  if (direct) return direct.id;
  return domainForSectionId(normalized as SettingsSectionId);
}
