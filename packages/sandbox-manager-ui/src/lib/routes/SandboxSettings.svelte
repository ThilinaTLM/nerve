<script lang="ts">
  import {
    BrainCircuit,
    CheckCircle2,
    Cloud,
    GitBranch,
    Globe2,
    KeyRound,
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
  import { Input } from "@nervekit/ui/components/ui/input";
  import { Label } from "@nervekit/ui/components/ui/label";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import { Textarea } from "@nervekit/ui/components/ui/textarea";
  import type {
    SandboxManagerCredentialProfile,
    SandboxManagerCredentialProfileKind,
    SandboxManagerCredentialProfileWrite,
    SandboxManagerCredentialProviderKind,
  } from "@nervekit/shared";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

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
  const configuredCount = $derived(store.credentialProfiles.length);

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
    applyOptionDefaults(option);
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
  <div class="flex flex-none flex-col gap-4 border-b bg-card px-5 py-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="max-w-3xl space-y-2">
        <div class="flex items-center gap-2 text-sm font-semibold text-primary">
          <ShieldCheck class="size-4" /> Manager-owned configuration
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
        <p class="text-sm text-muted-foreground">
          Configure every pi-ai LLM provider plus repository and tool credentials. Secret values are write-only; the manager stores and resolves scoped credential profiles for sandboxes.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Badge tone="accent" size="sm">{configuredCount} profiles</Badge>
        <Button variant="outline" size="sm" onclick={() => void store.refreshCredentials()}>
          <RefreshCw class="size-4" /> Refresh
        </Button>
      </div>
    </div>

    <div class="flex gap-2 overflow-x-auto pb-1">
      {#each sections as section (section.id)}
        {@const Icon = section.icon}
        <Button
          variant={activeSectionId === section.id ? "secondary" : "ghost"}
          size="sm"
          active={activeSectionId === section.id}
          onclick={() => selectSection(section.id)}
          class="flex-none"
        >
          <Icon class="size-4" /> {section.label}
        </Button>
      {/each}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-5">
    <div class="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="space-y-4">
        <Card class="border">
          <CardHeader>
            <div class="flex items-start justify-between gap-3">
              <div>
                <CardTitle class="text-base">{activeSection.label}</CardTitle>
                <p class="mt-1 text-sm text-muted-foreground">{activeSection.description}</p>
              </div>
              <Badge tone="neutral" size="xs">{groupedProfiles.length} configured</Badge>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            {#if activeSection.options.length === 0}
              <div class="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                {activeSection.emptyHint}
              </div>
            {:else if selectedOption}
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="flex flex-col gap-1 sm:col-span-2">
                  <Label>Provider/auth type</Label>
                  <SelectField
                    items={providerItems}
                    value={providerKind}
                    onValueChange={selectProvider}
                  />
                  <p class="text-xs text-muted-foreground">{selectedOption.detail}</p>
                </div>

                <div class="flex flex-col gap-1">
                  <Label>Display name</Label>
                  <Input bind:value={displayName} placeholder={selectedOption.label} />
                </div>

                <div class="flex flex-col gap-1">
                  <Label>Default model hint</Label>
                  <Input bind:value={defaultModel} placeholder={selectedOption.defaultModel ?? "model-id"} />
                </div>

                {#if selectedOption.kind === "model_provider"}
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

                <div class="flex flex-col gap-1 sm:col-span-2">
                  <Label>{secretLabel(selectedOption)}</Label>
                  {#if selectedOption.multiline}
                    <Textarea bind:value={secretValue} class="min-h-28 font-mono text-xs" placeholder={secretPlaceholder(selectedOption)} />
                  {:else}
                    <Input bind:value={secretValue} type="password" placeholder={secretPlaceholder(selectedOption)} />
                  {/if}
                  <p class="text-xs text-muted-foreground">Stored by the manager only. Existing values are never read back into this UI.</p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy || !secretValue || (selectedOption.secretMode === "githubApp" && (!githubAppId || !githubInstallationId))}
                  onclick={() => void saveProfile()}
                >
                  <KeyRound class="size-4" /> Save profile
                </Button>
                <Button variant="ghost" size="sm" onclick={() => applyOptionDefaults()}>Clear</Button>
              </div>
            {/if}

            {#if saved}
              <p class="flex items-center gap-2 rounded-md bg-success/10 p-2 text-xs text-success">
                <CheckCircle2 class="size-4" /> {saved}
              </p>
            {/if}
            {#if error}
              <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <TriangleAlert class="mt-0.5 size-4 flex-none" /> {error}
              </p>
            {/if}
          </CardContent>
        </Card>

        <Card class="border">
          <CardHeader><CardTitle class="text-base">Configured {activeSection.label}</CardTitle></CardHeader>
          <CardContent class="grid gap-2">
            {#if groupedProfiles.length === 0}
              <p class="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">No profiles configured for this section.</p>
            {:else}
              {#each groupedProfiles as profile (profile.profileId)}
                <div class="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
                  <div class="min-w-0 space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-sm font-medium">{profile.displayName}</p>
                      <Badge tone={statusTone(profile.status)} size="xs">{profile.status}</Badge>
                    </div>
                    <p class="truncate text-xs text-muted-foreground">
                      {profile.providerKind} · {profile.authType}{profile.provider ? ` · ${profile.provider}` : ""}
                    </p>
                    {#if profile.siteUrl || profile.email || profile.defaultModel || profile.defaultOwner || profile.defaultRepo || profile.defaultProjectKey || profile.defaultSpaceKey}
                      <p class="truncate text-xs text-muted-foreground">
                        {[profile.siteUrl, profile.email, profile.defaultModel, profile.defaultOwner, profile.defaultRepo, profile.defaultProjectKey, profile.defaultSpaceKey].filter(Boolean).join(" · ")}
                      </p>
                    {/if}
                    {#if profile.expiresAt}
                      <p class="truncate text-xs text-muted-foreground">expires {profile.expiresAt}</p>
                    {/if}
                    {#if profile.lastError}
                      <p class="truncate text-xs text-destructive">{profile.lastError.message}</p>
                    {/if}
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
              {/each}
            {/if}
          </CardContent>
        </Card>
      </div>

      <aside class="space-y-4">
        <Card class="border">
          <CardHeader><CardTitle class="text-sm">Secret handling</CardTitle></CardHeader>
          <CardContent class="space-y-3 text-sm text-muted-foreground">
            <p>Values are submitted over same-origin manager APIs and stored as manager-owned encrypted secrets.</p>
            <p>Sandbox config receives profile references, never raw provider keys.</p>
            <div class="flex items-center gap-2 rounded-md bg-muted/40 p-2 text-xs">
              <Globe2 class="size-4 text-info" /> Remote deployments should keep an authenticated proxy in front of the manager.
            </div>
          </CardContent>
        </Card>

        <Card class="border">
          <CardHeader><CardTitle class="text-sm">pi-ai coverage</CardTitle></CardHeader>
          <CardContent class="space-y-2 text-xs text-muted-foreground">
            <p><span class="font-medium text-foreground">LLM API keys</span> include all provider IDs exposed by the installed pi-ai package.</p>
            <p><span class="font-medium text-foreground">Provider env</span> carries non-secret routing/configuration values such as Cloudflare account IDs, Azure deployment maps, Vertex project/location, and AWS region.</p>
            <p><span class="font-medium text-foreground">Subscriptions</span> use OAuth bundle imports and can carry expiry metadata.</p>
            <p>Use the header Fleet action to return to the sandbox dashboard.</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  </div>
</div>
