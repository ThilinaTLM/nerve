# Configuration

A sandbox-agent is configured by one YAML document mounted inside an already-created container. The document describes model catalog, agent model selection, controller WebSocket settings, controller disconnect behavior, secret references and key-value secret stores, top-level Git/GitHub setup, model-callable tool groups, skills/context resources, boot behavior, storage, observability, and security policy. Manager/container launch choices such as identity, image, backend, labels, and CPU/memory resources live outside this YAML.

Manager-only settings such as container runtime driver selection, host volume source paths, manager database retention, and frontend auth are not part of the sandbox YAML unless explicitly documented. The manager materializes those concerns into mounts, environment variables, secret refs, and controller endpoints before launching the sandbox.

The configuration is an input contract for the sandbox daemon. It is not an authorization boundary by itself; the daemon and container runtime MUST enforce the declared policy.

## Loading rules

- The config file MUST parse as YAML and produce a mapping/object at the top level.
- `version` MUST be `1`.
- Implementations MUST validate the full document before applying Git/GitHub setup, running boot phases, connecting to the controller, or accepting run commands.
- Unknown top-level fields MUST be rejected unless the implementation is explicitly running with an experimental compatibility mode.
- Unknown fields under `labels`, `annotations`, `compat`, `providerOptions`, `toolOptions`, and explicitly documented extension objects MAY be accepted when the owning schema allows extension.
- Raw secrets MUST NOT be embedded in the YAML document.
- The sandbox SHOULD write a sanitized copy of the loaded config and its digest to `/state/config`.

## Config file location and schema

The sandbox-agent loads its YAML config from `NERVE_SANDBOX_AGENT_CONFIG` when set, otherwise from `/etc/nerve/sandbox.yaml`. The sandbox manager normally materializes and mounts that file read-only at `/etc/nerve/sandbox.yaml`.

The authoritative runtime schema is the Zod schema in `packages/contracts/src/domains/sandbox/sandbox.config.schema.ts` (`sandboxConfigV1Schema`). A generated Draft 7 JSON Schema for editor and YAML language-server tooling is committed at `packages/contracts/schemas/sandbox-config-v1.schema.json` and exported from `@nervekit/contracts/schemas/sandbox-config-v1.schema.json`.

YAML files can use JSON Schema because YAML maps to the JSON data model used by schema tooling. For local authoring, associate the schema explicitly:

```yaml
# yaml-language-server: $schema=./packages/contracts/schemas/sandbox-config-v1.schema.json
version: 1
```

The generated JSON Schema is an authoring aid, not the final security boundary. Runtime Zod validation remains authoritative, including cross-field hardening rules that JSON Schema tooling may not fully express, such as secret-store reference consistency, OAuth refresh persistence requirements, disconnect-policy consistency, selected model references, credential-backed tool group requirements, and raw-secret rejection.

## Manager-owned authentication model

The sandbox manager/controller owns interactive authentication and account-level authorization. The sandbox only receives credential references, already-issued credential bundles, and optional secret-store endpoints.

Requirements:

- The sandbox MUST NOT run browser login, device-code login, OAuth authorization-code login, `gh auth login`, `npm login`, `pip login`, or equivalent interactive authentication flows.
- The manager MAY provide API keys, bearer tokens, OAuth bundles, SSH keys, GPG keys, package registry tokens, Jira tokens, Confluence tokens, GitHub credentials, and model-provider credentials through `SecretRef` values.
- `SecretRef` values MAY point to environment variables, mounted files, or configured key-value secret stores.
- The sandbox MAY refresh provided OAuth bundles when the config includes refresh material and refresh is enabled.
- If a credential cannot be resolved or refreshed and no valid fallback remains, the affected provider, setup step, or tool group MUST become unavailable or fail closed.
- Controller WebSocket authentication uses API-key transport auth in baseline v1. OAuth for controller transport is reserved for a future profile.

## Secret references and secret stores

Secrets are referenced, not embedded.

```ts
type SecretRef = { env: string } | { file: string } | { kv: KvSecretRef };

type KvSecretRef = {
  /** Optional store id. Defaults to secretStores.defaultStore. */
  store?: string;
  /** Store-local key/name. */
  key: string;
  /** Optional version, revision, or stage label. */
  version?: string;
};

type SecretStoresConfig = {
  defaultStore?: string;
  stores?: Record<string, SecretStoreConfig>;
};

type SecretStoreConfig = HttpKvSecretStoreConfig;

type HttpKvSecretStoreConfig = {
  type: "http_kv";
  endpoint: string;
  method?: "GET" | "POST"; // default: POST
  keyParam?: string; // default: key
  versionParam?: string; // default: version
  response?: {
    valueJsonPointer?: string; // default: /value
    expiresAtJsonPointer?: string;
  };
  auth?: SecretStoreAuthConfig;
  cache?: {
    enabled?: boolean; // default: false unless implementation opts in
    ttlMs?: number;
    maxEntries?: number;
  };
  timeoutMs?: number;
};

type SecretStoreAuthConfig =
  | { type: "none" }
  | { type: "api_key"; apiKey: SecretRef; header?: string; scheme?: string }
  | { type: "bearer"; token: SecretRef }
  | OAuthCredentialConfig;
```

Requirements:

- `env` MUST name an environment variable available to the sandbox daemon.
- `file` MUST reference a mounted file path, normally under read-only `/secrets` or a protected manager-provided credential mount.
- `kv` MUST reference a configured key-value secret store by key. If `store` is omitted, `secretStores.defaultStore` MUST be present and MUST resolve to a configured store. Implementations MUST NOT infer a singleton store implicitly.
- Secret values MUST be resolved lazily, only when the daemon or a tool actually needs the secret.
- Resolved secret values MUST be redacted from logs, events, transcripts, errors, snapshots, and config digests.
- Secret files SHOULD be readable only by the sandbox user and SHOULD NOT be under `/workspace`.
- Secret-store authentication credentials are themselves secrets and MUST be resolved through `SecretRef` without recursion cycles.
- Secret-store HTTP calls MUST comply with `security.network` and any advertised firewall policy.
- Secret-store responses MUST be size-bounded. Only the configured secret value field is treated as credential material.
- Cached secret-store values, if enabled, MUST be stored only in protected state or memory, MUST honor TTL/expiry where provided, and MUST NOT be exposed through ordinary file tools.
- `auth.type: none` SHOULD be used only for local, private, manager-owned endpoints isolated by network policy.
- Config digests SHOULD include secret reference locations and key names, not resolved values. When key names are sensitive, implementations MAY hash or redact them in externally visible events while retaining enough local metadata for debugging.

## Credential configuration

Credential references are used by model providers, web search, Jira, Confluence, Git, GitHub, package registries, signing tools, and secret stores.

```ts
type CredentialConfig =
  | ApiKeyCredentialConfig
  | BearerTokenCredentialConfig
  | BasicCredentialConfig
  | OAuthCredentialConfig
  | SshCredentialConfig
  | GpgCredentialConfig;

type ApiKeyCredentialConfig = {
  type: "api_key";
  apiKey: SecretRef;
  headerName?: string;
  prefix?: string;
};

type BearerTokenCredentialConfig = {
  type: "bearer";
  token: SecretRef;
};

type BasicCredentialConfig = {
  type: "basic";
  username: string;
  password: SecretRef;
};

type OAuthCredentialConfig = {
  type: "oauth";
  provider?: string;
  /** JSON bundle, normally pi-ai compatible: { access, refresh, expires, ... }. */
  source?: SecretRef;
  accessToken?: SecretRef;
  refreshToken?: SecretRef;
  expiresAt?: string | SecretRef;
  refresh?: {
    enabled?: boolean; // default: true when refresh material exists
    minTtlMs?: number; // default: 300000
    persist?: "state" | "file" | "none"; // default: state
    file?: string; // required when persist=file
  };
};

type SshCredentialConfig = {
  type: "ssh";
  privateKey: SecretRef;
  passphrase?: SecretRef;
  publicKey?: SecretRef;
  knownHosts?: SecretRef;
};

type GpgCredentialConfig = {
  type: "gpg";
  privateKey: SecretRef;
  passphrase?: SecretRef;
  keyId?: string;
};
```

OAuth requirements:

- For pi-ai-backed model providers, `OAuthCredentialConfig.source` SHOULD use the pi-ai OAuth credential shape `{ refresh: string; access: string; expires: number; ... }` with any provider-specific fields.
- The sandbox MUST treat `refresh`, `access`, `accessToken`, `refreshToken`, and provider-specific credential fields as secrets.
- Refreshed credentials MUST be written using an atomic write pattern and stored under `/state/credentials` by default.
- If `refresh.persist` is `file`, the configured file MUST be outside `/workspace`, MUST be writable only by the sandbox user, and SHOULD be a manager-owned credential-sync mount.
- If `refresh.persist` is `none`, refresh results MAY be used in memory only; the sandbox MUST report that restart may require the manager to provide fresh credentials.
- The sandbox MUST emit only redacted credential status, such as provider ID, credential type, expiry time, and refresh success/failure.

## Canonical shape

```ts
type SandboxConfigV1 = {
  version: 1;
  secretStores?: SecretStoresConfig;
  modelCatalog?: ModelCatalogConfig;
  agent: AgentConfig;
  controller: ControllerConfig;
  git?: GitConfig;
  github?: GithubConfig;
  tools?: ToolsConfig;
  skills?: SkillsConfig;
  boot?: BootConfig;
  security?: SecurityConfig;
  storage?: StorageConfig;
  observability?: ObservabilityConfig;
};

Sandbox identity, display name, container labels, image, backend, and CPU/memory resources are manager launch config, not sandbox-agent YAML. Managed sandboxes receive `NERVE_SANDBOX_AGENT_SANDBOX_ID` and `NERVE_SANDBOX_AGENT_INSTANCE_ID` from the manager at container start.

type AgentConfig = {
  defaultModel: AgentModelSelection;
  defaultExploreModel?: AgentModelSelection;
  systemPromptAmendment?: string;
  defaultMode?: "normal" | "planning";
  defaultPermissionLevel?: "read_only" | "supervised" | "autonomous";
  workspaceRoot?: string; // default: /workspace
  maxRuns?: number;
  maxExploreDepth?: number;
};

type AgentModelSelection = {
  provider: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
};
```

`agent.defaultModel` and `agent.defaultExploreModel` are selectors only. Provider connection details, credentials, API compatibility, and model metadata live in `modelCatalog` or the runtime's bundled pi-ai catalog. First user prompts are conversation-level input and MUST be sent later with `sandbox.run.start.prompt`; they are not mounted in sandbox YAML.

## pi-ai model catalog

Sandbox v1 model catalog configuration is designed to cover the same provider/model concepts that pi-ai and the Nerve agent runtime support, while keeping agent model selection simple.

```ts
type PiApi =
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-vertex"
  | "mistral-conversations"
  | "openai-compatible"
  | "gemini-compatible"
  | "anthropic-compatible";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ModelCatalogConfig = {
  providers?: ProviderCatalogConfig[];
  models?: ModelDefinitionConfig[];
};

type ProviderCatalogConfig = {
  id: string;
  displayName?: string;

  /** True when id maps to a bundled pi-ai provider. */
  builtin?: boolean;

  /** Required for custom providers, optional override for built-ins. */
  api?: PiApi;
  baseUrl?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  credential?: CredentialConfig;
  providerOptions?: Record<string, unknown>;
};

type ModelDefinitionConfig = {
  provider: string;
  model: string;
  name?: string;
  aliases?: string[];

  /** Optional per-model overrides or metadata. */
  api?: PiApi;
  baseUrl?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  reasoning?: boolean;
  supportedThinkingLevels?: ThinkingLevel[];
  thinkingLevelMap?: Record<string, string | null>;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
};
```

Requirements:

- Built-in provider/model IDs SHOULD resolve through the runtime's bundled pi-ai catalog.
- Built-in providers do not need to list models explicitly unless the manager is overriding metadata, adding aliases, or enabling a provider-specific credential not available by other means.
- Custom providers MUST define enough provider-level information to create a client: `api`, `baseUrl`, and `credential`, unless the provider is explicitly marked unavailable by an implementation-specific extension and is not selected by any agent.
- Custom OpenAI-, Gemini-, and Anthropic-compatible providers SHOULD use the corresponding `*-compatible` API values when the exact pi-ai built-in API does not apply.
- `modelCatalog.models` is REQUIRED only for custom models unknown to the bundled catalog or for model metadata overrides.
- `headers` MUST NOT contain raw secret values. Sensitive headers SHOULD be represented as `credential` values or injected by the provider client at execution time.
- `compat` is intentionally provider-specific and is validated by the runtime/provider integration.
- `providerOptions` is an extension object for implementation-specific safe options. It MUST NOT carry raw secrets.
- The sandbox MUST report unsupported providers, API types, model IDs, thinking levels, or credential modes before advertising the model as active.
- `agent.defaultModel.provider`/`model` and `agent.defaultExploreModel.provider`/`model` MUST resolve through either `modelCatalog` or the bundled catalog.

### Built-in OAuth model provider examples

`openai-codex` and Anthropic subscription auth are represented as provider credentials in `modelCatalog` when the manager has authenticated the account.

```yaml
modelCatalog:
  providers:
    - id: openai-codex
      builtin: true
      credential:
        type: oauth
        provider: openai-codex
        source:
          file: /secrets/model/openai-codex-oauth.json
        refresh:
          enabled: true
          persist: state

agent:
  defaultModel:
    provider: openai-codex
    model: gpt-5-codex
    thinkingLevel: medium
```

```yaml
modelCatalog:
  providers:
    - id: anthropic
      builtin: true
      credential:
        type: oauth
        provider: anthropic
        source:
          kv:
            store: manager
            key: model/anthropic/oauth
        refresh:
          enabled: true
          minTtlMs: 600000

agent:
  defaultModel:
    provider: anthropic
    model: claude-sonnet-4-5
    thinkingLevel: high
```

The sandbox MUST NOT start an Anthropic or OpenAI login flow. It MAY call the runtime/provider refresh implementation using the provided refresh material. If refresh succeeds and token rotation returns a new bundle, the sandbox MUST persist that bundle according to `refresh.persist`.

## Controller configuration

```ts
type ControllerConfig = {
  websocket: {
    url: string;
    connectTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    reconnect?: ReconnectConfig;
    headers?: Record<string, string>;
  };
  auth: ApiKeyAuthConfig;
  disconnectPolicy?: ControllerDisconnectPolicy;
};

type ControllerDisconnectPolicy = {
  /** Default: exit_self. */
  mode?: "exit_self" | "stay_reconnecting";
  /** Default: 300000. Required to be finite for production exit_self. */
  exitAfterMs?: number;
};

type ApiKeyAuthConfig = {
  type: "api_key";
  apiKey: SecretRef;
  header?: string; // default: Authorization
  scheme?: string; // default: Bearer
};

type ReconnectConfig = {
  minDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  jitter?: boolean;
};
```

Controller transport auth and disconnect requirements:

- `controller.auth.type` MUST be `api_key` in baseline v1.
- The API key MUST be used only for WebSocket connection setup and MUST NOT appear in protocol payloads.
- A v1 implementation MUST reject `controller.auth.type: oauth` unless it explicitly advertises an experimental controller-transport OAuth capability.
- `controller.disconnectPolicy.mode` defaults to `exit_self`.
- `controller.disconnectPolicy.exitAfterMs` defaults to `300000`.
- In production, `exit_self` MUST use a finite positive timeout. `stay_reconnecting` is an unsafe/dev or specialized controller mode and MUST be reported in effective config limitations.
- On retryable controller disconnect, the sandbox enters reconnecting state. If it cannot establish a valid protocol session before `exitAfterMs`, it MUST exit itself after persisting local shutdown state when possible.

## Tool group configuration

Tools are configured by model-callable group. Group-level config controls enablement, tool-level filters, and approval posture. Git and GitHub setup are not tool groups; they are configured by top-level `git` and `github` blocks.

```ts
type ToolsConfig = {
  groups?: {
    fileInspection?: ToolGroupConfig;
    fileEditing?: ToolGroupConfig;
    planMode?: ToolGroupConfig;
    todos?: ToolGroupConfig;
    web?: WebToolGroupConfig;
    jira?: JiraToolGroupConfig;
    confluence?: ConfluenceToolGroupConfig;
    taskManagement?: TaskToolGroupConfig;
    shell?: ShellToolGroupConfig;
    python?: PythonToolGroupConfig;
    explore?: ExploreToolGroupConfig;
  };
};

type ToolGroupConfig = {
  enabled?: boolean;
  tools?: {
    enabled?: string[];
    disabled?: string[];
  };
  requireApproval?: "never" | "risky" | "always";
  toolOptions?: Record<string, unknown>;
};
```

Recommended group/tool names:

| Group key        | Tool names                                                                           |
| ---------------- | ------------------------------------------------------------------------------------ |
| `fileInspection` | `read`, `ls`, `find`, `grep`                                                         |
| `fileEditing`    | `write`, `edit`                                                                      |
| `planMode`       | `plan_mode_enter`, `plan_mode_present`, `plan_mode_force_exit`                       |
| `todos`          | `todos_set`, `todos_get`                                                             |
| `web`            | `web_search`, `web_fetch`                                                            |
| `jira`           | Jira issue/user/project tools                                                        |
| `confluence`     | Confluence page/space/attachment tools                                               |
| `taskManagement` | `task_start`, `task_status`, `task_logs`, `task_cancel`, `task_restart`, `task_list` |
| `shell`          | `bash`                                                                               |
| `python`         | `python`                                                                             |
| `explore`        | `explore`                                                                            |

Activation requirements:

- A group is active only when implementation support, group enablement, required config, required credentials, security policy, permission level, and controller approvals all allow it.
- If a group is enabled but missing credentials/config, the sandbox MUST report the group as unavailable and MUST NOT advertise its tools as active.
- `tools.enabled` and `tools.disabled` inside a group are tool-name filters. Group policy still applies to all tools in the group.
- `toolOptions` MUST NOT contain raw secrets.
- Git/GitHub command execution, when exposed through `shell` or future dedicated tools, still uses tool policy and approval checks. Top-level `git`/`github` config only prepares identity, credentials, remotes, CLI/API auth, and optional checkout.

### Web group

```ts
type WebToolGroupConfig = ToolGroupConfig & {
  provider?: "tavily" | "controller" | "direct" | string;
  credential?: CredentialConfig;
  maxFetchBytes?: number;
  allowedContentTypes?: string[];
};
```

When `provider: tavily`, `credential` SHOULD be an API key for Tavily. `web_fetch` may use direct egress or controller-mediated fetch depending on implementation support.

### Jira and Confluence groups

```ts
type JiraToolGroupConfig = ToolGroupConfig & {
  siteUrl?: string;
  baseUrl?: string;
  email?: string;
  credential?: CredentialConfig;
  defaultProjectKey?: string;
};

type ConfluenceToolGroupConfig = ToolGroupConfig & {
  siteUrl?: string;
  baseUrl?: string;
  email?: string;
  credential?: CredentialConfig;
  defaultSpaceKey?: string;
};
```

Jira and Confluence tools are disabled unless the group is enabled and required URL, identity, and credential fields are configured. When `jira.enabled: true`, either `siteUrl` or `baseUrl`, `email`, and `credential` are REQUIRED. When `confluence.enabled: true`, either `siteUrl` or `baseUrl`, `email`, and `credential` are REQUIRED. Atlassian API tokens are represented as `credential.type: api_key`; OAuth may be used only by implementations that support Atlassian OAuth refresh from provided bundles. Mutation tools SHOULD require approval in `supervised` mode.

### Shell, Python, task management, and explore groups

```ts
type ShellToolGroupConfig = ToolGroupConfig & {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  allowLongRunning?: boolean;
  envAllowlist?: string[];
};

type PythonToolGroupConfig = ToolGroupConfig & {
  executablePath?: string;
  network?: "inherit" | "deny" | "allow";
  fileWrites?: "workspace" | "deny";
};

type TaskToolGroupConfig = ToolGroupConfig & {
  maxTasks?: number;
  maxTaskRuntimeMs?: number;
  allowNetworkListeners?: boolean;
};

type ExploreToolGroupConfig = ToolGroupConfig & {
  maxDepth?: number;
  maxParallel?: number;
};
```

Shell commands run as the sandbox user by default and MUST NOT receive all environment variables automatically. The explore group SHOULD default to read-oriented tools and inherit parent security policy; it uses `agent.defaultExploreModel` when configured, otherwise `agent.defaultModel`.

## Git configuration

Git configuration is first-class because repository cloning, identity, signing, and remotes are common sandbox startup requirements. Git setup runs during sandbox startup after config validation and before `boot.script`/`boot.phases`, so boot phases can assume configured identity, signing state, credentials, and optional checkout are ready.

```ts
type GitConfig = {
  enabled?: boolean;
  identity?: GitIdentityConfig;
  credentials?: Record<string, GitCredentialProfileConfig>;
  clone?: GitCloneConfig;
  remotes?: GitRemoteConfig[];
  safeDirectory?: "workspace" | "none" | string[];
  lfs?: boolean;
  defaultBranch?: string;
};

type GitIdentityConfig = {
  name?: string;
  email?: string;
  signCommits?: boolean;
  signingFormat?: "openpgp" | "ssh";
  signingKeyId?: string;
  gpgPrivateKey?: SecretRef;
  gpgPassphrase?: SecretRef;
  sshSigningKey?: SecretRef;
};

type GitCredentialProfileConfig = {
  match?: {
    protocol?: "https" | "ssh";
    host?: string;
    user?: string;
    pathPrefix?: string;
  };
  credential: CredentialConfig;
};

type GitCredentialRef = string | CredentialConfig;

type GitCloneConfig = {
  url?: string;
  ref?: string;
  targetDir?: string; // default: /workspace
  depth?: number;
  submodules?: boolean;
  credential?: GitCredentialRef; // prefer named entries from git.credentials
  ifWorkspaceNotEmpty?: "skip" | "fail" | "replace"; // default: skip
};

type GitRemoteConfig = {
  name: string;
  url: string;
  pushUrl?: string;
  credential?: GitCredentialRef;
};
```

Requirements:

- `git.enabled: true` prepares Git identity, signing state, credentials, safe-directory config, configured remotes, and optional clone before boot phases.
- Git credentials MUST be injected narrowly, for example through `GIT_ASKPASS`, `GIT_SSH_COMMAND`, an isolated SSH config, or credential helpers scoped to protected state.
- Git identity MUST be written to sandbox-global config under protected state before clone or boot (`GIT_CONFIG_GLOBAL=/state/git/config` in the reference image). It MUST NOT write to `/agent`, the immutable image home, or host-global config.
- GPG material MUST use an isolated `GNUPGHOME` under protected state and MUST NOT be copied to `/workspace`.
- Startup clone/fetch network access MUST comply with `security.network` and any firewall profile.
- Top-level Git config does not by itself grant model-callable Git operations. Git commands invoked later through shell or dedicated tools MUST still pass tool policy, risk classification, and approval requirements.

## GitHub configuration

GitHub configuration covers GitHub API/CLI setup. It is first-class startup configuration, not a tool group. Git transport credentials for GitHub-hosted clone/fetch/push SHOULD live in `git.credentials`; the same manager secret may also back `github.auth` for GitHub API/CLI calls.

```ts
type GithubConfig = {
  enabled?: boolean;
  host?: string; // default: github.com
  auth?: GithubAuthConfig;
  cli?: {
    enabled?: boolean;
    protocol?: "https" | "ssh";
  };
  defaultOwner?: string;
  defaultRepo?: string;
};

type GithubAuthConfig =
  | { type: "pat"; token: SecretRef }
  | { type: "app_token"; token: SecretRef }
  | {
      type: "ssh";
      privateKey: SecretRef;
      passphrase?: SecretRef;
      knownHosts?: SecretRef;
    }
  | OAuthCredentialConfig;
```

Requirements:

- `github.enabled: true` prepares GitHub API/CLI authentication before boot phases when configured.
- The sandbox MUST NOT run `gh auth login` or a browser/device login.
- PAT/App tokens SHOULD be injected as `GH_TOKEN` or equivalent only for the GitHub client process or a scoped protected CLI auth file.
- SSH auth MUST use a scoped `GIT_SSH_COMMAND`/SSH config and pinned `known_hosts` where provided.
- Startup GitHub API/CLI calls MUST comply with `security.network` and any firewall profile.
- Top-level GitHub config does not by itself grant model-callable GitHub operations. API/CLI operations invoked later through shell or dedicated tools MUST still pass tool policy, risk classification, and approval requirements.

## Skills and context resources

The sandbox supports the same harness resources as the existing agent runtime: `AGENTS.md` context files and `SKILL.md` skills. Skills are prompt resources, not authority.

```ts
type SkillsConfig = {
  enabled?: boolean; // default: true when implementation supports skills
  contextFiles?: {
    enabled?: boolean; // default: true
    names?: string[]; // default: ["AGENTS.md", "AGENTS.MD"]
    includeAncestors?: boolean; // default: true
  };
  builtin?: {
    enabled?: boolean; // default: true
    path?: string; // default: /agent/skills
    include?: string[];
    exclude?: string[];
  };
  project?: {
    enabled?: boolean; // default: true
    path?: string; // default: /workspace/.agents/skills
    includeAncestors?: boolean; // default: true when safely resolvable
  };
  searchPaths?: string[];
  allowWorkspaceSkills?: boolean; // default: true
  legacyNervePaths?: boolean; // default: false
  maxSkillBytes?: number;
  maxSkillCount?: number;
};
```

Requirements:

- `AGENTS.md` files SHOULD be loaded as project context resources from `/workspace` and, when enabled, safe ancestor directories within the workspace mount.
- Built-in skills SHOULD live under read-only `/agent/skills`.
- Project skills SHOULD be loaded from `/workspace/.agents/skills` by default when `allowWorkspaceSkills` is true.
- Manager-provided skills MAY be mounted read-only and listed in `searchPaths`.
- `.nerve` project skill/system-prompt paths are not v1 defaults. Implementations MAY support them only when `legacyNervePaths` or an implementation-specific compatibility mode is enabled.
- Skill loading MUST be deterministic. Earlier search paths SHOULD win on duplicate names and duplicates SHOULD be reported in diagnostics.
- Skill metadata such as `allowed-tools` is advisory prompt metadata only. It MUST NOT bypass sandbox tool policy.
- Skills, context-file summaries, and diagnostics SHOULD be reported in `sandbox.skills.loaded` without full unbounded contents.

## Boot and package access

Boot setup runs after startup validation and after top-level Git/GitHub setup, but before the sandbox accepts run commands. System packages should be installed in derived images; boot is intended for repository setup, dependency installation, generated workspace files, and convenience checks.

```ts
type BootConfig = {
  script?: string;
  phases?: BootPhaseConfig[];
  timeoutMs?: number;
  runAs?: "sandbox" | "root";
  onFailure?: "fail_sandbox" | "continue_readonly";
  network?: "inherit" | "deny" | "package_registries_only";
};

type BootPhaseConfig = {
  name: string;
  script: string;
  timeoutMs?: number;
  runAs?: "sandbox" | "root";
  network?: "inherit" | "deny" | "package_registries_only";
  env?: Record<string, SecretRef>;
};
```

Boot requirements:

- Production boot phases MUST run as the `sandbox` user by default.
- `runAs: root` is an unsafe/dev profile and MUST emit a visible security warning. It SHOULD be rejected in production profiles.
- Boot writes MUST be limited to `/workspace`, `/tmp`, `/state`, and configured cache/credential mounts.
- Boot MUST NOT write to `/agent` or `/agent/skills`.
- Language package manager access is governed by the intersection of `boot.network`, `boot.phases[*].network`, `security.network`, advertised firewall policy, and explicit credential injection through `SecretRef` values. Boot network modes MUST NOT expand global network policy. There is no top-level `dependencies` block in v1.
- `boot.script` and `boot.phases` SHOULD NOT both be set. Implementations SHOULD reject configs that set both unless they document deterministic ordering; the recommended ordering is `boot.script` as a phase named `default` before `boot.phases`.
- `boot.phases[*].name` values MUST be unique.
- Package-manager caches SHOULD live under `/state/cache/dependencies` or an implementation-documented protected cache path.
- Private registry tokens MUST be injected only into the package manager invocation or temporary config under protected state.

## Security, storage, and observability

```ts
type SecurityConfig = {
  filesystem?: FilesystemSecurityConfig;
  network?: NetworkSecurityConfig;
  apt?: AptSecurityConfig;
  process?: ProcessSecurityConfig;
  capabilities?: CapabilitySecurityConfig;
  firewall?: FirewallSecurityConfig;
};

type FilesystemSecurityConfig = {
  workspaceDir?: string; // default: /workspace
  stateDir?: string; // default: /state
  tempDir?: string; // default: /tmp
  agentDir?: string; // default: /agent
  builtinSkillsDir?: string; // default: /agent/skills
  writable?: string[]; // default: [/workspace, /tmp, /state]
  readonly?: string[];
  denySymlinkEscape?: boolean;
};

type NetworkSecurityConfig = {
  default?: "allow" | "deny";
  allow?: string[];
  deny?: string[];
  packageRegistryHosts?: string[];
  dns?: "system" | "controller" | "disabled";
};

type FirewallSecurityConfig = {
  enabled?: boolean;
  backend?: "container" | "iptables" | "nftables" | "proxy" | "cni" | "none";
  enforceBootPhaseNetwork?: boolean;
};

type AptSecurityConfig = {
  allowed?: boolean;
  mode?: "disabled" | "build_time_only" | "runtime";
};

type ProcessSecurityConfig = {
  runAsUser?: string;
  noNewPrivileges?: boolean;
  maxProcesses?: number;
  maxTaskRuntimeMs?: number;
};

type CapabilitySecurityConfig = {
  dropAll?: boolean;
  add?: string[];
  privileged?: boolean;
};

type StorageConfig = {
  stateDir?: string; // default: /state
  retention?: {
    maxRuns?: number;
    maxAgeDays?: number;
    maxBytes?: number;
  };
  checkpoint?: {
    onEveryTurn?: boolean;
    intervalMs?: number;
  };
  credentials?: {
    dir?: string; // default: /state/credentials
    persistRefreshes?: boolean; // default: true
  };
  cache?: {
    dependencyDir?: string; // default: /state/cache/dependencies
    secretStoreDir?: string; // default: /state/cache/secrets
  };
};

type ObservabilityConfig = {
  logLevel?: "debug" | "info" | "warn" | "error";
  redact?: string[];
  emitProviderMetadata?: boolean;
};
```

## Defaults

If omitted, implementations SHOULD use these defaults:

| Field                                      | Default                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `agent.defaultMode`                        | `normal`                                                                  |
| `agent.defaultPermissionLevel`             | `supervised`                                                              |
| `agent.workspaceRoot`                      | `/workspace`                                                              |
| `agent.maxRuns`                            | `8`                                                                       |
| `agent.maxExploreDepth`                    | `3`                                                                       |
| `controller.auth.header`                   | `Authorization`                                                           |
| `controller.auth.scheme`                   | `Bearer`                                                                  |
| `controller.websocket.heartbeatIntervalMs` | `30000`                                                                   |
| `controller.disconnectPolicy.mode`         | `exit_self`                                                               |
| `controller.disconnectPolicy.exitAfterMs`  | `300000`                                                                  |
| `git.enabled`                              | `false` unless configured                                                 |
| `github.enabled`                           | `false` unless configured                                                 |
| `tools.groups.fileInspection.enabled`      | `true`                                                                    |
| `tools.groups.fileEditing.enabled`         | based on permission level, default available in `supervised`/`autonomous` |
| `tools.groups.planMode.enabled`            | `true`                                                                    |
| `tools.groups.todos.enabled`               | `true`                                                                    |
| `tools.groups.web.enabled`                 | `false` unless configured                                                 |
| `tools.groups.jira.enabled`                | `false`                                                                   |
| `tools.groups.confluence.enabled`          | `false`                                                                   |
| `tools.groups.taskManagement.enabled`      | implementation-specific, false if unmanaged tasks unsupported             |
| `tools.groups.shell.enabled`               | `true` when shell support is installed                                    |
| `tools.groups.python.enabled`              | `true` when Python support is installed                                   |
| `tools.groups.explore.enabled`             | `true` when subagent support is installed                                 |
| `skills.enabled`                           | `true` when implementation supports skills                                |
| `skills.contextFiles.names`                | [`AGENTS.md`, `AGENTS.MD`]                                                |
| `skills.builtin.path`                      | `/agent/skills`                                                           |
| `skills.project.path`                      | `/workspace/.agents/skills`                                               |
| `skills.allowWorkspaceSkills`              | `true`                                                                    |
| `skills.legacyNervePaths`                  | `false`                                                                   |
| `boot.timeoutMs`                           | `300000`                                                                  |
| `boot.runAs`                               | `sandbox`                                                                 |
| `boot.onFailure`                           | `fail_sandbox`                                                            |
| `boot.network`                             | `deny` unless Git/GitHub setup or boot phase policy requires egress       |
| `security.filesystem.writable`             | [`/workspace`, `/tmp`, `/state`]                                          |
| `security.filesystem.denySymlinkEscape`    | `true`                                                                    |
| `security.network.default`                 | `deny`                                                                    |
| `security.apt.allowed`                     | `false`                                                                   |
| `security.apt.mode`                        | `build_time_only`                                                         |
| `security.process.runAsUser`               | `sandbox`                                                                 |
| `security.process.noNewPrivileges`         | `true`                                                                    |
| `security.capabilities.dropAll`            | `true`                                                                    |
| `security.capabilities.privileged`         | `false`                                                                   |
| `storage.stateDir`                         | `/state`                                                                  |
| `storage.credentials.dir`                  | `/state/credentials`                                                      |
| `storage.credentials.persistRefreshes`     | `true`                                                                    |
| `storage.cache.dependencyDir`              | `/state/cache/dependencies`                                               |
| `storage.cache.secretStoreDir`             | `/state/cache/secrets`                                                    |
| `observability.logLevel`                   | `info`                                                                    |

An implementation MAY choose a stricter default. It MUST NOT silently choose a weaker default than the table without documenting the change and emitting it in `sandbox.config.loaded`.

## Example

```yaml
version: 1

secretStores:
  defaultStore: manager
  stores:
    manager:
      type: http_kv
      endpoint: https://api.example.invalid/sandboxes/secrets/resolve
      auth:
        type: api_key
        apiKey:
          env: NERVE_SECRET_STORE_API_KEY
      response:
        valueJsonPointer: /value
      cache:
        enabled: true
        ttlMs: 300000

modelCatalog:
  providers:
    - id: anthropic
      builtin: true
      credential:
        type: oauth
        provider: anthropic
        source:
          kv:
            key: model/anthropic/oauth
        refresh:
          enabled: true
          persist: state
    - id: openai-codex
      builtin: true
      credential:
        type: oauth
        provider: openai-codex
        source:
          kv:
            key: model/openai-codex/oauth
        refresh:
          enabled: true
    - id: corp-openai
      displayName: Corp OpenAI Gateway
      api: openai-compatible
      baseUrl: https://models.example.invalid/openai/v1
      credential:
        type: bearer
        token:
          kv:
            key: model/corp-openai/token
  models:
    - provider: corp-openai
      model: gpt-4.1-corp
      name: GPT 4.1 via Corp Gateway
      reasoning: false
      supportedThinkingLevels: [off]

agent:
  defaultModel:
    provider: anthropic
    model: claude-sonnet-4-5
    thinkingLevel: medium
  defaultExploreModel:
    provider: openai-codex
    model: gpt-5-codex
    thinkingLevel: low
  # First user prompts are sent later with sandbox.run.start.prompt.
  systemPromptAmendment: |
    Prefer small, reviewable changes and explain tradeoffs before risky edits.
  defaultPermissionLevel: supervised

controller:
  websocket:
    url: wss://api.example.invalid/sandboxes/connect
    heartbeatIntervalMs: 30000
    reconnect:
      minDelayMs: 1000
      maxDelayMs: 30000
      multiplier: 2
      jitter: true
  auth:
    type: api_key
    apiKey:
      env: NERVE_SANDBOX_AGENT_API_KEY

git:
  enabled: true
  identity:
    name: Nerve Sandbox Bot
    email: nerve-bot@example.invalid
    signCommits: true
    signingFormat: ssh
    sshSigningKey:
      kv:
        key: git/signing-key
  credentials:
    github-ssh:
      match:
        protocol: ssh
        host: github.com
        user: git
      credential:
        type: ssh
        privateKey:
          kv:
            key: git/id_ed25519
        knownHosts:
          kv:
            key: git/known_hosts
  clone:
    url: git@github.com:example/repo.git
    ref: main
    targetDir: /workspace
    depth: 50
    credential: github-ssh
  remotes:
    - name: origin
      url: git@github.com:example/repo.git
      credential: github-ssh
  safeDirectory: workspace
  lfs: false

github:
  enabled: true
  host: github.com
  auth:
    type: pat
    token:
      kv:
        key: github/pat
  cli:
    enabled: true
    protocol: ssh
  defaultOwner: example
  defaultRepo: repo

tools:
  groups:
    fileInspection:
      enabled: true
    fileEditing:
      enabled: true
      requireApproval: risky
    shell:
      enabled: true
      defaultTimeoutMs: 30000
      maxTimeoutMs: 300000
      allowLongRunning: false
    python:
      enabled: true
      network: inherit
      fileWrites: workspace
    web:
      enabled: true
      provider: tavily
      credential:
        type: api_key
        apiKey:
          kv:
            key: tavily/api-key
    jira:
      enabled: true
      siteUrl: https://example.atlassian.net
      email: bot@example.invalid
      defaultProjectKey: NER
      credential:
        type: api_key
        apiKey:
          kv:
            key: atlassian/jira-token
    confluence:
      enabled: true
      siteUrl: https://example.atlassian.net
      email: bot@example.invalid
      defaultSpaceKey: DEV
      credential:
        type: api_key
        apiKey:
          kv:
            key: atlassian/confluence-token
    taskManagement:
      enabled: true
      maxTasks: 8
    explore:
      enabled: true
      maxDepth: 3
      maxParallel: 5

skills:
  enabled: true
  contextFiles:
    enabled: true
  builtin:
    enabled: true
    path: /agent/skills
  project:
    enabled: true
    path: /workspace/.agents/skills
  searchPaths:
    - /secrets/skills
  allowWorkspaceSkills: true

boot:
  phases:
    - name: install-js
      network: package_registries_only
      timeoutMs: 600000
      env:
        NPM_TOKEN:
          kv:
            key: registries/npm/token
      script: |
        cd /workspace
        corepack enable
        if [ -f pnpm-lock.yaml ]; then
          pnpm install --frozen-lockfile
        fi
    - name: git-status
      network: deny
      script: |
        cd /workspace
        git status --short || true
  onFailure: fail_sandbox

security:
  filesystem:
    writable:
      - /workspace
      - /tmp
      - /state
    readonly:
      - /agent
      - /agent/skills
      - /secrets
    denySymlinkEscape: true
  network:
    default: deny
    allow:
      - api.anthropic.com
      - chatgpt.com
      - api.openai.com
      - api.tavily.com
      - api.example.invalid
      - models.example.invalid
      - example.atlassian.net
      - github.com
      - api.github.com
      - registry.npmjs.org
    packageRegistryHosts:
      - registry.npmjs.org
  apt:
    allowed: false
    mode: build_time_only
  process:
    runAsUser: sandbox
    noNewPrivileges: true
    maxProcesses: 256
  capabilities:
    dropAll: true
    privileged: false

storage:
  stateDir: /state
  credentials:
    dir: /state/credentials
    persistRefreshes: true
  cache:
    dependencyDir: /state/cache/dependencies
    secretStoreDir: /state/cache/secrets
  retention:
    maxRuns: 100
    maxAgeDays: 30
  checkpoint:
    onEveryTurn: true

observability:
  logLevel: info
```

## Config digest

The sandbox MUST compute a stable digest of the sanitized, canonicalized configuration.

Requirements:

- The digest MUST exclude resolved secret values.
- The digest SHOULD include secret reference locations such as `{ env: "ANTHROPIC_API_KEY" }`, `{ file: "/secrets/model/anthropic-oauth.json" }`, or `{ kv: { store: "manager", key: "model/anthropic/oauth" } }`, subject to configured key-name redaction.
- The digest SHOULD include model/provider IDs, model catalog summaries, top-level Git/GitHub setup status inputs, tool-group enablement, skill/context search paths, secret store IDs/endpoints without auth values, boot phase names, and network/package registry hostnames.
- The digest SHOULD be emitted in `sandbox.config.loaded` and included in health/status responses.
- If a resumed `/state` directory contains a different previous config digest, the sandbox MUST emit a warning event and follow the configured recovery policy.

## Validation failures

If config validation fails before the WebSocket session is established, the daemon MUST log a redacted local error and exit non-zero.

If config validation fails after a session exists, the sandbox SHOULD send a protocol `error` with code `VALIDATION_FAILED` and `close: true`, then exit non-zero.

Common validation failures include:

- raw-secret-like values placed directly in YAML credential fields;
- `controller.auth.type` other than `api_key` in baseline v1;
- `credential.type: oauth` without a source/access token or usable refresh material for a provider that requires refresh;
- `kv` secret refs without an explicit store and no `secretStores.defaultStore`, without a resolvable store, or with recursive secret-store auth;
- secret-store endpoint/auth configuration unsupported by the runtime;
- agent model selectors that reference unknown providers, unknown models, or unsupported thinking levels;
- tool group enabled without required URL/identity/credential fields;
- custom provider selected by an agent without required `api`, `baseUrl`, or credential;
- duplicate boot phase names;
- `controller.disconnectPolicy.exitAfterMs` missing/non-finite in production `exit_self` mode;
- Git or GitHub keys under `/workspace`;
- Git/GitHub startup setup requested but network policy cannot allow required hosts or report enforcement;
- root boot in production profile;
- package-manager boot phase requested but network/firewall policy cannot allow required registry hosts;
- skill search paths outside allowed read roots.
