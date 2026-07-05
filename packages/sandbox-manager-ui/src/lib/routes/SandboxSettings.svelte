<script lang="ts">
  import {
    BrainCircuit,
    CheckCircle2,
    Cloud,
    ExternalLink,
    GitBranch,
    KeyRound,
    LoaderCircle,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    ShieldCheck,
    TriangleAlert,
  } from "@lucide/svelte";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "@nervekit/ui/components/ui/card";
  import DialogShell from "@nervekit/ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { Label } from "@nervekit/ui/components/ui/label";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import { Textarea } from "@nervekit/ui/components/ui/textarea";
  import type {
    ModelInfo,
    SandboxManagerCredentialProfile,
    SandboxManagerCredentialProfileKind,
    SandboxManagerCredentialProfileWrite,
    SandboxManagerCredentialProviderKind,
  } from "@nervekit/shared";
  import { SandboxManagerOAuthFlow } from "../components/credentials/sandbox-manager-oauth-flow.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import {
    formatTokens,
    modelDisplayName,
    providerDisplayName,
  } from "../utils/model-display";

  type SettingsSectionId =
    | "llm_subscriptions"
    | "llm_api_keys"
    | "git"
    | "github"
    | "jira"
    | "confluence"
    | "web_search";

  type ProviderOption = {
    providerKind: SandboxManagerCredentialProviderKind;
    label: string;
    detail: string;
    kind: SandboxManagerCredentialProfileKind;
    provider: string;
    secretMode: "apiKey" | "oauth" | "githubApp" | "privateKey";
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

  type SettingsSection = {
    id: SettingsSectionId;
    label: string;
    description: string;
    icon: typeof BrainCircuit;
    options: ProviderOption[];
    emptyHint?: string;
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
    apiProvider("xai_api_key", "xAI", "xai", "xAI Grok API key.", "grok-code-fast-1"),
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

  const sections: SettingsSection[] = [
    {
      id: "llm_subscriptions",
      label: "LLM subscriptions",
      description:
        "OAuth/subscription credentials that the manager can refresh before a sandbox needs them.",
      icon: BrainCircuit,
      options: llmSubscriptions,
    },
    {
      id: "llm_api_keys",
      label: "LLM API keys",
      description:
        "Write-only model provider keys for every pi-ai LLM provider plus custom endpoints.",
      icon: KeyRound,
      options: llmApiKeys,
    },
    {
      id: "git",
      label: "Git",
      description: "Repository-level Git identity and generic Git host auth.",
      icon: Settings2,
      options: [],
      emptyHint:
        "Generic Git identity settings are not yet backed by a first-class manager profile. Use GitHub profiles below for GitHub-hosted repositories.",
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

  const store = useSandboxManagerStore();
  let activeSectionId = $state<SettingsSectionId>("llm_subscriptions");
  let providerKind = $state<SandboxManagerCredentialProviderKind>(
    "anthropic_oauth",
  );
  let displayName = $state("");
  let secretValue = $state("");
  let siteUrl = $state("");
  let email = $state("");
  let defaultModel = $state("");
  let api = $state("");
  let baseUrl = $state("");
  let envJson = $state("");
  let headersJson = $state("");
  let compatJson = $state("");
  let providerOptionsJson = $state("");
  let defaultOwner = $state("");
  let defaultRepo = $state("");
  let defaultProjectKey = $state("");
  let defaultSpaceKey = $state("");
  let githubAppId = $state("");
  let githubInstallationId = $state("");
  let busy = $state(false);
  let refreshingProfileId = $state<string | undefined>(undefined);
  let addDialogOpen = $state(false);
  let manualOAuthImport = $state(false);
  let error = $state<string | undefined>(undefined);
  let saved = $state<string | undefined>(undefined);

  const activeSection = $derived(
    sections.find((section) => section.id === activeSectionId) ?? sections[0],
  );
  const selectedOption = $derived(
    activeSection.options.find((option) => option.providerKind === providerKind),
  );
  const providerItems = $derived(
    activeSection.options.map((option) => ({
      value: option.providerKind,
      label: option.label,
      detail: option.detail,
    })),
  );
  const groupedProfiles = $derived(profilesForSection(activeSection));
  const ActiveSectionIcon = $derived(activeSection.icon);
  const selectedProviderModels = $derived.by<ModelInfo[]>(() =>
    selectedOption?.kind === "model_provider"
      ? store.models
          .filter((model) => model.provider === selectedOption.provider)
          .sort((left, right) =>
            modelDisplayName(left).localeCompare(modelDisplayName(right)),
          )
      : [],
  );
  const modelItems = $derived.by(() => {
    const items = selectedProviderModels.map((model) => ({
      value: model.modelId,
      label: modelDisplayName(model),
      detail: `${providerDisplayName(model.provider)} · ${model.modelId} · ${model.reasoning ? "Reasoning" : "Standard"} · ${formatTokens(model.contextWindow)}`,
    }));
    if (
      defaultModel.trim() &&
      selectedProviderModels.length > 0 &&
      !items.some((item) => item.value === defaultModel)
    ) {
      return [
        {
          value: defaultModel,
          label: `${defaultModel} (current)`,
          detail: "Current template value",
        },
        ...items,
      ];
    }
    return items;
  });
  const configuredCount = $derived(store.credentialProfiles.length);
  const oauthFlow = new SandboxManagerOAuthFlow({
    onSucceeded: async (flow) => {
      await store.refreshCredentials();
      saved = flow.message ?? `Connected ${flow.providerName}.`;
      error = undefined;
      manualOAuthImport = false;
      addDialogOpen = false;
      applyOptionDefaults(selectedOption, false);
    },
  });

  $effect(() => {
    if (activeSection.options.length === 0) return;
    if (
      !activeSection.options.some((option) => option.providerKind === providerKind)
    ) {
      providerKind = activeSection.options[0].providerKind;
      applyOptionDefaults(activeSection.options[0], false);
    }
  });

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

  function profilesForSection(
    section: SettingsSection,
  ): SandboxManagerCredentialProfile[] {
    const kinds = new Set(section.options.map((option) => option.providerKind));
    return store.credentialProfiles.filter((profile) => kinds.has(profile.providerKind));
  }

  function prettyJson(value: Record<string, unknown> | undefined): string {
    return value ? JSON.stringify(value, null, 2) : "";
  }

  function applyOptionDefaults(
    option: ProviderOption | undefined = selectedOption,
    clearMessages = true,
  ): void {
    displayName = "";
    secretValue = "";
    siteUrl = "";
    email = "";
    defaultModel = option?.defaultModel ?? "";
    api = option?.api ?? "";
    baseUrl = option?.baseUrl ?? "";
    envJson = prettyJson(option?.envTemplate);
    headersJson = prettyJson(option?.headersTemplate);
    compatJson = prettyJson(option?.compatTemplate);
    providerOptionsJson = prettyJson(option?.providerOptionsTemplate);
    defaultOwner = "";
    defaultRepo = "";
    defaultProjectKey = "";
    defaultSpaceKey = "";
    githubAppId = "";
    githubInstallationId = "";
    if (clearMessages) {
      error = undefined;
      saved = undefined;
    }
  }

  function selectSection(sectionId: SettingsSectionId): void {
    activeSectionId = sectionId;
    const section = sections.find((item) => item.id === sectionId);
    if (section?.options[0]) providerKind = section.options[0].providerKind;
    applyOptionDefaults(section?.options[0]);
  }

  function selectProvider(value: string): void {
    providerKind = value as SandboxManagerCredentialProviderKind;
    const option = activeSection.options.find(
      (item) => item.providerKind === providerKind,
    );
    manualOAuthImport = false;
    if (oauthFlow.active) void oauthFlow.close();
    else oauthFlow.reset();
    applyOptionDefaults(option);
  }

  function openAddDialog(sectionId: SettingsSectionId = activeSectionId): void {
    const section = sections.find((item) => item.id === sectionId);
    if (!section?.options[0]) return;
    activeSectionId = section.id;
    providerKind = section.options[0].providerKind;
    manualOAuthImport = false;
    if (oauthFlow.active) void oauthFlow.close();
    else oauthFlow.reset();
    applyOptionDefaults(section.options[0]);
    addDialogOpen = true;
  }

  function supportsBrowserOAuth(option: ProviderOption | undefined): boolean {
    return Boolean(
      option &&
        option.kind === "model_provider" &&
        option.secretMode === "oauth" &&
        [
          "anthropic_oauth",
          "openai_codex_oauth",
          "github_copilot_oauth",
        ].includes(option.providerKind),
    );
  }

  function useBrowserOAuth(option: ProviderOption | undefined): boolean {
    return supportsBrowserOAuth(option) && !manualOAuthImport;
  }

  async function closeAddDialog(): Promise<void> {
    await oauthFlow.close();
    manualOAuthImport = false;
    addDialogOpen = false;
  }

  function handleAddDialogOpenChange(next: boolean): void {
    if (!next) void closeAddDialog();
  }

  async function startBrowserOAuth(): Promise<void> {
    if (!selectedOption || !supportsBrowserOAuth(selectedOption)) return;
    await oauthFlow.begin({
      provider: selectedOption.provider,
      displayName: displayName.trim() || selectedOption.label,
      defaultModel: defaultModel.trim() || undefined,
    });
  }

  function secretLabel(option: ProviderOption): string {
    if (option.secretMode === "oauth") return "OAuth bundle JSON";
    if (option.secretMode === "privateKey") return "Private key";
    if (option.secretMode === "githubApp") return "GitHub App private key";
    return "Secret value";
  }

  function secretPlaceholder(option: ProviderOption): string {
    if (option.secretMode === "oauth")
      return '{"accessToken":"...","refreshToken":"...","expiresAt":"..."}';
    if (option.secretMode === "privateKey" || option.secretMode === "githubApp")
      return "-----BEGIN PRIVATE KEY-----";
    return "write-only";
  }

  function statusTone(
    status: SandboxManagerCredentialProfile["status"],
  ): "good" | "warn" | "danger" | "neutral" {
    if (status === "configured") return "good";
    if (status === "invalid" || status === "revoked" || status === "expired")
      return "danger";
    if (status === "refreshing" || status === "needs_login") return "warn";
    return "neutral";
  }

  function configuredFields(
    profile: SandboxManagerCredentialProfile,
  ): { label: string; value: string }[] {
    return [
      { label: "Provider", value: profile.provider ?? "" },
      { label: "API", value: profile.api ?? "" },
      { label: "Base URL", value: profile.baseUrl ?? "" },
      { label: "Site", value: profile.siteUrl ?? "" },
      { label: "Email", value: profile.email ?? "" },
      { label: "Default model", value: profile.defaultModel ?? "" },
      { label: "Owner", value: profile.defaultOwner ?? "" },
      { label: "Repository", value: profile.defaultRepo ?? "" },
      { label: "Project", value: profile.defaultProjectKey ?? "" },
      { label: "Space", value: profile.defaultSpaceKey ?? "" },
    ].filter((field) => field.value.trim().length > 0);
  }

  function profileTimeline(
    profile: SandboxManagerCredentialProfile,
  ): { label: string; value: string }[] {
    return [
      { label: "Expires", value: profile.expiresAt ?? "" },
      { label: "Refresh after", value: profile.refreshAfter ?? "" },
      { label: "Last refresh", value: profile.lastRefreshAt ?? "" },
      { label: "Validated", value: profile.lastValidatedAt ?? "" },
      { label: "Updated", value: profile.updatedAt },
    ].filter((field) => field.value.trim().length > 0);
  }

  function secretRefSummary(profile: SandboxManagerCredentialProfile): string {
    if (profile.secretRefs.length === 0) return "No secret refs reported";
    const configured = profile.secretRefs.filter((ref) => ref.configured).length;
    const purposes = profile.secretRefs.map((ref) => ref.purpose).join(", ");
    return `${configured}/${profile.secretRefs.length} configured · ${purposes}`;
  }

  function parseJsonObject<T extends Record<string, unknown>>(
    raw: string,
    label: string,
  ): T | undefined {
    if (!raw.trim()) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error(`${label} must be a JSON object`);
    return parsed as T;
  }

  function parseStringRecord(
    raw: string,
    label: string,
  ): Record<string, string> | undefined {
    const parsed = parseJsonObject<Record<string, unknown>>(raw, label);
    if (!parsed) return undefined;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string")
        throw new Error(`${label} value for ${key} must be a string`);
      result[key] = value;
    }
    return result;
  }

  async function saveProfile(): Promise<void> {
    if (!selectedOption) return;
    busy = true;
    error = undefined;
    saved = undefined;
    try {
      const request: SandboxManagerCredentialProfileWrite = {
        kind: selectedOption.kind,
        providerKind: selectedOption.providerKind,
        displayName: displayName.trim() || selectedOption.label,
        provider: selectedOption.provider,
        api: api.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        siteUrl: siteUrl.trim() || undefined,
        email: email.trim() || undefined,
        headers: parseStringRecord(headersJson, "Headers"),
        compat: parseJsonObject(compatJson, "Compatibility"),
        providerOptions: parseJsonObject(providerOptionsJson, "Provider options"),
        env: parseStringRecord(envJson, "Provider env"),
        defaultModel: defaultModel.trim() || undefined,
        defaultOwner: defaultOwner.trim() || undefined,
        defaultRepo: defaultRepo.trim() || undefined,
        defaultProjectKey: defaultProjectKey.trim() || undefined,
        defaultSpaceKey: defaultSpaceKey.trim() || undefined,
      };
      if (selectedOption.secretMode === "oauth")
        request.oauthImport = parseJsonObject(secretValue, "OAuth bundle");
      else if (selectedOption.secretMode === "githubApp") {
        request.githubApp = {
          appId: githubAppId.trim(),
          installationId: githubInstallationId.trim(),
          privateKey: secretValue,
        };
      } else if (selectedOption.secretMode === "privateKey")
        request.privateKey = secretValue;
      else request.apiKey = secretValue;
      await store.createCredentialProfile(request);
      saved = `Saved ${request.displayName}`;
      applyOptionDefaults(selectedOption, false);
      manualOAuthImport = false;
      addDialogOpen = false;
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : String(saveError);
    } finally {
      busy = false;
    }
  }

  async function refreshProfile(profileId: string): Promise<void> {
    refreshingProfileId = profileId;
    error = undefined;
    saved = undefined;
    try {
      await store.refreshCredentialProfile(profileId);
      saved = "Profile refreshed";
    } catch (refreshError) {
      error = refreshError instanceof Error ? refreshError.message : String(refreshError);
    } finally {
      refreshingProfileId = undefined;
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
  <div class="flex flex-none flex-wrap items-start justify-between gap-3 border-b bg-card px-5 py-5">
    <div class="max-w-3xl space-y-2">
      <div class="flex items-center gap-2 text-sm font-semibold text-primary">
        <ShieldCheck class="size-4" /> Manager-owned configuration
      </div>
      <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
      <p class="text-sm text-muted-foreground">
        Review configured profiles first, then add subscriptions, API keys, and tool credentials only when a sandbox needs them. Secret values are write-only and resolved by the manager.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Badge tone="accent" size="sm">{configuredCount} profiles</Badge>
      <Button variant="outline" size="sm" onclick={() => void store.refreshCredentials()}>
        <RefreshCw class="size-4" /> Refresh
      </Button>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-5">
    <div class="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row">
      <aside class="lg:w-80 lg:flex-none">
        <Card class="border">
          <CardHeader class="border-b p-4">
            <CardTitle class="text-sm">Configuration sections</CardTitle>
            <p class="text-xs text-muted-foreground">Choose a section to review configured options.</p>
          </CardHeader>
          <CardContent class="grid gap-1 p-2">
            {#each sections as section (section.id)}
              {@const Icon = section.icon}
              {@const sectionCount = profilesForSection(section).length}
              <Button
                variant={activeSectionId === section.id ? "secondary" : "ghost"}
                active={activeSectionId === section.id}
                aria-current={activeSectionId === section.id ? "page" : undefined}
                onclick={() => selectSection(section.id)}
                class="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
              >
                <span class="rounded-md bg-muted p-2 text-muted-foreground">
                  <Icon class="size-4" />
                </span>
                <span class="min-w-0 flex-1 space-y-1">
                  <span class="flex items-center justify-between gap-2">
                    <span class="truncate text-sm font-medium">{section.label}</span>
                    <Badge tone={sectionCount > 0 ? "accent" : "neutral"} size="xs">
                      {sectionCount}
                    </Badge>
                  </span>
                  <span class="line-clamp-2 whitespace-normal text-xs font-normal text-muted-foreground">
                    {section.description}
                  </span>
                </span>
              </Button>
            {/each}
          </CardContent>
        </Card>
      </aside>

      <main class="min-w-0 flex-1 space-y-4">
        <Card class="border">
          <CardHeader class="border-b p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 gap-3">
                <div class="rounded-md bg-muted p-2 text-primary">
                  <ActiveSectionIcon class="size-5" />
                </div>
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <CardTitle class="text-base">{activeSection.label}</CardTitle>
                    <Badge tone="neutral" size="xs">{groupedProfiles.length} configured</Badge>
                  </div>
                  <p class="text-sm text-muted-foreground">{activeSection.description}</p>
                </div>
              </div>
              {#if activeSection.options.length > 0}
                <Button size="sm" onclick={() => openAddDialog()}>
                  <Plus class="size-4" /> Add configuration
                </Button>
              {/if}
            </div>
          </CardHeader>
          <CardContent class="space-y-3 p-4">
            {#if activeSection.options.length === 0}
              <div class="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                {activeSection.emptyHint}
              </div>
            {:else}
              <div class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <ShieldCheck class="size-4 text-success" />
                <span>Secrets stay write-only in the manager. Sandboxes receive profile references instead of raw keys.</span>
              </div>
            {/if}

            {#if saved}
              <p class="flex items-center gap-2 rounded-md bg-success/10 p-2 text-xs text-success">
                <CheckCircle2 class="size-4" /> {saved}
              </p>
            {/if}
            {#if error && !addDialogOpen}
              <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <TriangleAlert class="mt-0.5 size-4 flex-none" /> {error}
              </p>
            {/if}
          </CardContent>
        </Card>

        <Card class="border">
          <CardHeader class="border-b p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle class="text-base">Configured options</CardTitle>
                <p class="mt-1 text-sm text-muted-foreground">
                  Safe metadata for manager-owned profiles in {activeSection.label}.
                </p>
              </div>
              {#if activeSection.options.length > 0 && groupedProfiles.length > 0}
                <Button variant="outline" size="sm" onclick={() => openAddDialog()}>
                  <Plus class="size-4" /> Add another
                </Button>
              {/if}
            </div>
          </CardHeader>
          <CardContent class="p-4">
            {#if groupedProfiles.length === 0}
              <div class="flex flex-col items-start gap-3 rounded-md border bg-muted/30 p-5">
                <div class="space-y-1">
                  <p class="text-sm font-medium">No profiles configured for this section.</p>
                  <p class="text-sm text-muted-foreground">
                    Add a configuration when a sandbox needs this provider. Existing secret values will never be displayed here.
                  </p>
                </div>
                {#if activeSection.options.length > 0}
                  <Button size="sm" onclick={() => openAddDialog()}>
                    <Plus class="size-4" /> Add configuration
                  </Button>
                {/if}
              </div>
            {:else}
              <div class="grid gap-3 xl:grid-cols-2">
                {#each groupedProfiles as profile (profile.profileId)}
                  <article class="rounded-md border bg-card p-4">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h2 class="truncate text-sm font-semibold">{profile.displayName}</h2>
                          <Badge tone={statusTone(profile.status)} size="xs">{profile.status}</Badge>
                        </div>
                        <p class="truncate text-xs text-muted-foreground">
                          {profile.providerKind} · {profile.authType}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={refreshingProfileId === profile.profileId}
                        onclick={() => void refreshProfile(profile.profileId)}
                      >
                        <RefreshCw class="size-3" /> Refresh
                      </Button>
                    </div>

                    <div class="mt-3 grid gap-2 sm:grid-cols-2">
                      {#each configuredFields(profile) as field}
                        <div class="min-w-0 rounded-md border bg-muted/30 px-2 py-1.5">
                          <p class="text-xs text-muted-foreground">{field.label}</p>
                          <p class="truncate text-xs font-medium">{field.value}</p>
                        </div>
                      {/each}
                    </div>

                    <div class="mt-3 rounded-md border bg-muted/20 px-2 py-1.5">
                      <p class="text-xs text-muted-foreground">Secret refs</p>
                      <p class="truncate text-xs font-medium">{secretRefSummary(profile)}</p>
                    </div>

                    <div class="mt-3 grid gap-2 sm:grid-cols-2">
                      {#each profileTimeline(profile) as item}
                        <div class="min-w-0 rounded-md border bg-background px-2 py-1.5">
                          <p class="text-xs text-muted-foreground">{item.label}</p>
                          <p class="truncate font-mono text-xs">{item.value}</p>
                        </div>
                      {/each}
                    </div>

                    {#if profile.lastError}
                      <p class="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                        <TriangleAlert class="mt-0.5 size-4 flex-none" /> {profile.lastError.message}
                      </p>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          </CardContent>
        </Card>
      </main>
    </div>
  </div>
</div>

<DialogShell
  bind:open={addDialogOpen}
  title={`Add ${activeSection.label}`}
  description="Create a manager-owned profile. Secret values are submitted once and never read back into the browser."
  onOpenChange={handleAddDialogOpenChange}
>
  <div class="space-y-4 p-5">
    {#if selectedOption}
      <div class="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <span class="font-medium text-foreground">{selectedOption.label}:</span>
        {selectedOption.detail}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1 sm:col-span-2">
          <Label>Provider/auth type</Label>
          <SelectField
            items={providerItems}
            value={providerKind}
            onValueChange={selectProvider}
          />
        </div>

        <div class="flex flex-col gap-1">
          <Label>Display name</Label>
          <Input bind:value={displayName} placeholder={selectedOption.label} />
        </div>

        {#if selectedOption.kind === "model_provider"}
          <div class="flex flex-col gap-1">
            <Label>Default model</Label>
            {#if selectedProviderModels.length > 0}
              <SelectField
                items={modelItems}
                value={defaultModel}
                placeholder="Pick a pi-ai model"
                onValueChange={(value) => (defaultModel = value)}
              />
              <p class="text-xs text-muted-foreground">Loaded from the installed pi-ai model catalog.</p>
            {:else}
              <Input bind:value={defaultModel} placeholder={selectedOption.defaultModel ?? "model-id"} />
              <p class="text-xs text-muted-foreground">No built-in pi-ai models found for this provider; enter a model ID.</p>
            {/if}
          </div>
          <div class="flex flex-col gap-1">
            <Label>pi-ai provider ID</Label>
            <Input value={selectedOption.provider} readonly />
          </div>
          <div class="flex flex-col gap-1">
            <Label>API family override</Label>
            <Input bind:value={api} placeholder="builtin provider default" />
          </div>
          <div class="flex flex-col gap-1 sm:col-span-2">
            <Label>Base URL override</Label>
            <Input bind:value={baseUrl} placeholder="builtin provider default" />
          </div>
        {/if}

        {#if selectedOption.site}
          <div class="flex flex-col gap-1">
            <Label>Site URL</Label>
            <Input bind:value={siteUrl} placeholder="https://example.atlassian.net" />
          </div>
        {/if}

        {#if selectedOption.email}
          <div class="flex flex-col gap-1">
            <Label>Email</Label>
            <Input bind:value={email} placeholder="you@example.com" />
          </div>
        {/if}

        {#if selectedOption.githubDefaults}
          <div class="flex flex-col gap-1">
            <Label>Default owner</Label>
            <Input bind:value={defaultOwner} placeholder="organization" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Default repository</Label>
            <Input bind:value={defaultRepo} placeholder="repository" />
          </div>
        {/if}

        {#if selectedOption.jiraDefaults}
          <div class="flex flex-col gap-1">
            <Label>Default project key</Label>
            <Input bind:value={defaultProjectKey} placeholder="ENG" />
          </div>
        {/if}

        {#if selectedOption.confluenceDefaults}
          <div class="flex flex-col gap-1">
            <Label>Default space key</Label>
            <Input bind:value={defaultSpaceKey} placeholder="DOCS" />
          </div>
        {/if}

        {#if selectedOption.secretMode === "githubApp"}
          <div class="flex flex-col gap-1">
            <Label>GitHub App ID</Label>
            <Input bind:value={githubAppId} placeholder="123456" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Installation ID</Label>
            <Input bind:value={githubInstallationId} placeholder="987654" />
          </div>
        {/if}

        {#if selectedOption.kind === "model_provider"}
          <div class="flex flex-col gap-1 sm:col-span-2">
            <Label>Provider env JSON</Label>
            <Textarea bind:value={envJson} class="min-h-24 font-mono text-xs" placeholder={JSON.stringify({ CLOUDFLARE_ACCOUNT_ID: "..." })} />
            <p class="text-xs text-muted-foreground">Non-secret pi-ai env overrides such as account IDs, regions, project IDs, deployment maps, or locations.</p>
          </div>
          <div class="grid gap-3 sm:col-span-2 sm:grid-cols-3">
            <div class="flex flex-col gap-1">
              <Label>Headers JSON</Label>
              <Textarea bind:value={headersJson} class="min-h-20 font-mono text-xs" placeholder={JSON.stringify({ "X-Title": "Nerve" })} />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Compat JSON</Label>
              <Textarea bind:value={compatJson} class="min-h-20 font-mono text-xs" placeholder={JSON.stringify({ supportsStore: false })} />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Provider options JSON</Label>
              <Textarea bind:value={providerOptionsJson} class="min-h-20 font-mono text-xs" placeholder={JSON.stringify({ routing: { order: [] } })} />
            </div>
          </div>
        {/if}

        {#if useBrowserOAuth(selectedOption)}
          <div class="space-y-3 sm:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label>Subscription login</Label>
                <p class="mt-1 text-xs text-muted-foreground">
                  Complete OAuth in your browser. The manager stores the resulting subscription credential as a profile.
                </p>
              </div>
              <Button variant="outline" size="sm" onclick={() => (manualOAuthImport = true)}>
                Import OAuth bundle JSON instead
              </Button>
            </div>

            {#if !oauthFlow.flow}
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                <div class="space-y-1">
                  <p class="text-sm font-medium">Ready to connect {selectedOption.label}</p>
                  <p class="text-xs text-muted-foreground">A browser window opens for the provider login flow.</p>
                </div>
                <Button size="sm" disabled={oauthFlow.busy} onclick={() => void startBrowserOAuth()}>
                  {#if oauthFlow.busy}
                    <LoaderCircle class="spin size-4" /> Starting…
                  {:else}
                    <ExternalLink class="size-4" /> Login with browser
                  {/if}
                </Button>
              </div>
            {:else}
              <div class="space-y-3 rounded-md border bg-muted/30 p-3" aria-live="polite">
                {#if oauthFlow.flow.message}
                  <p class="text-sm font-medium">{oauthFlow.flow.message}</p>
                {/if}

                {#if oauthFlow.flow.status === "auth_url" && oauthFlow.flow.authUrl}
                  <Button variant="outline" size="sm" onclick={() => oauthFlow.flow?.authUrl && oauthFlow.openExternal(oauthFlow.flow.authUrl)}>
                    <ExternalLink class="size-4" /> Open login page
                  </Button>
                  {#if oauthFlow.flow.instructions}
                    <p class="text-xs text-muted-foreground">{oauthFlow.flow.instructions}</p>
                  {/if}
                {:else if oauthFlow.flow.status === "device_code" && oauthFlow.flow.deviceCode}
                  <div class="space-y-2">
                    <Button variant="outline" size="sm" onclick={() => oauthFlow.flow?.deviceCode && oauthFlow.openExternal(oauthFlow.flow.deviceCode.verificationUri)}>
                      <ExternalLink class="size-4" /> Open verification page
                    </Button>
                    <p class="text-xs text-muted-foreground">Enter this code:</p>
                    <code class="inline-flex rounded-md border bg-background px-2 py-1 font-mono text-sm font-semibold">{oauthFlow.flow.deviceCode.userCode}</code>
                  </div>
                {:else if oauthFlow.flow.status === "select" && oauthFlow.flow.options}
                  <div class="flex flex-wrap gap-2">
                    {#each oauthFlow.flow.options as option (option.id)}
                      <Button variant="outline" size="sm" disabled={oauthFlow.busy} onclick={() => void oauthFlow.selectOption(option.id)}>
                        {option.label}
                      </Button>
                    {/each}
                  </div>
                {:else if oauthFlow.flow.status === "prompt"}
                  <form
                    class="space-y-2"
                    onsubmit={(event) => {
                      event.preventDefault();
                      void oauthFlow.submitPrompt();
                    }}
                  >
                    {#if oauthFlow.flow.authUrl}
                      <Button variant="outline" size="sm" onclick={() => oauthFlow.flow?.authUrl && oauthFlow.openExternal(oauthFlow.flow.authUrl)}>
                        <ExternalLink class="size-4" /> Open login page
                      </Button>
                    {/if}
                    {#if oauthFlow.flow.instructions}
                      <p class="text-xs text-muted-foreground">{oauthFlow.flow.instructions}</p>
                    {/if}
                    <Input
                      type="text"
                      autocomplete="off"
                      placeholder={oauthFlow.flow.placeholder ?? "Paste the code or redirect URL"}
                      bind:value={oauthFlow.promptValue}
                      disabled={oauthFlow.busy}
                    />
                  </form>
                {:else if oauthFlow.flow.status === "failed"}
                  <div class="space-y-2">
                    <p class="text-sm font-medium text-destructive">The login attempt ended before credentials were saved.</p>
                    {#if oauthFlow.flow.error}
                      <p class="text-xs text-destructive">{oauthFlow.flow.error}</p>
                    {/if}
                    <Button variant="outline" size="sm" disabled={oauthFlow.busy} onclick={() => void oauthFlow.restart()}>
                      Start a fresh login
                    </Button>
                  </div>
                {:else if oauthFlow.flow.status === "succeeded"}
                  <p class="text-sm font-medium text-success">Connected to {oauthFlow.flow.providerName}.</p>
                {:else}
                  <p class="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle class="spin size-4" /> Working…
                  </p>
                {/if}
              </div>
            {/if}

            {#if oauthFlow.error}
              <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <TriangleAlert class="mt-0.5 size-4 flex-none" /> {oauthFlow.error}
              </p>
            {/if}
          </div>
        {:else}
          <div class="flex flex-col gap-1 sm:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <Label>{secretLabel(selectedOption)}</Label>
              {#if supportsBrowserOAuth(selectedOption)}
                <Button variant="ghost" size="xs" onclick={() => (manualOAuthImport = false)}>
                  Use browser login instead
                </Button>
              {/if}
            </div>
            {#if selectedOption.multiline}
              <Textarea bind:value={secretValue} class="min-h-28 font-mono text-xs" placeholder={secretPlaceholder(selectedOption)} />
            {:else}
              <Input bind:value={secretValue} type="password" placeholder={secretPlaceholder(selectedOption)} />
            {/if}
            <p class="text-xs text-muted-foreground">Stored by the manager only. Existing values are never read back into this UI.</p>
          </div>
        {/if}
      </div>

      {#if error}
        <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <TriangleAlert class="mt-0.5 size-4 flex-none" /> {error}
        </p>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    {#if selectedOption}
      <Button variant="ghost" size="sm" onclick={() => void closeAddDialog()}>Cancel</Button>
      {#if useBrowserOAuth(selectedOption)}
        {#if oauthFlow.flow?.status === "prompt"}
          <Button
            size="sm"
            disabled={oauthFlow.busy || (!oauthFlow.flow.allowEmpty && oauthFlow.promptValue.trim().length === 0)}
            onclick={() => void oauthFlow.submitPrompt()}
          >
            Submit
          </Button>
        {/if}
      {:else}
        <Button variant="outline" size="sm" onclick={() => applyOptionDefaults()}>Clear</Button>
        <Button
          size="sm"
          disabled={busy || !secretValue || (selectedOption.secretMode === "githubApp" && (!githubAppId || !githubInstallationId))}
          onclick={() => void saveProfile()}
        >
          <KeyRound class="size-4" /> Save configuration
        </Button>
      {/if}
    {/if}
  {/snippet}
</DialogShell>