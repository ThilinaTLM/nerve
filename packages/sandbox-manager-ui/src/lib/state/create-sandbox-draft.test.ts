import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sandboxCreateConfigInputSchema } from "@nervekit/shared";
import { parse as parseYaml } from "yaml";
import {
  buildConfigFromDraft,
  buildCreateRequest,
  CREATE_SANDBOX_PREFERENCES_STORAGE_KEY,
  configInputToYaml,
  configToYaml,
  createDefaultBootPhase,
  createDefaultBootSecretEnv,
  createDefaultDraft,
  createDraftFromStoredPreferences,
  parseSandboxConfigYaml,
  saveCreateSandboxPreferences,
} from "./create-sandbox-draft";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function validSandboxConfigYaml(sandboxId: string): string {
  return [
    "version: 1",

    "agent:",
    "  defaultModel:",
    "    provider: anthropic",
    "    model: claude-sonnet-4-5",
    "controller:",
    "  websocket:",
    `    url: wss://manager.example.test/api/sandboxes/${sandboxId}/ws`,
    "  auth:",
    "    type: api_key",
    "    apiKey:",
    "      file: /secrets/controller-token",
  ].join("\n");
}

describe("create sandbox draft", () => {
  it("uses the requested defaults and a readable generated identity", () => {
    const draft = createDefaultDraft();
    assert.equal(draft.mode, "normal");
    assert.equal(draft.permissionLevel, "autonomous");
    assert.equal(draft.defaultThinking, "off");
    assert.equal(draft.defaultExploreThinking, "off");
    assert.equal(draft.disconnectPolicyMode, "exit_self");
    assert.equal(draft.disconnectExitAfterSeconds, "300");
    assert.equal(draft.name, draft.sandboxId);
    assert.match(draft.name, /^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("builds a valid request with manager-owned controller policy", () => {
    const draft = createDefaultDraft();
    draft.name = "demo";
    draft.labels = "team=core, env=dev";
    draft.backend = "docker";
    draft.memoryMb = "8192";
    draft.vcpu = "2";
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.launch?.name, "demo");
    assert.equal(result.request.start, true);
    assert.equal(
      result.request.config.agent.defaultModel.provider,
      "anthropic",
    );
    assert.equal(result.request.config.agent.defaultModel.thinkingLevel, "off");
    assert.equal(result.request.launch?.backend, "docker");
    assert.deepEqual(result.request.launch?.labels, {
      team: "core",
      env: "dev",
    });
    assert.deepEqual(result.request.launch?.resources, {
      memoryMb: 8192,
      vcpu: 2,
    });
    // Transport and auth are manager-owned; the form only supplies shutdown policy.
    assert.deepEqual(result.request.config.controller, {
      disconnectPolicy: { mode: "exit_self", exitAfterMs: 300_000 },
    });
  });

  it("maps the selected thinking level into the main model config", () => {
    const draft = createDefaultDraft();
    draft.defaultThinking = "high";
    const config = buildConfigFromDraft(draft);
    assert.equal(config.agent.defaultModel.thinkingLevel, "high");
  });

  it("maps tool toggles into tool groups", () => {
    const draft = createDefaultDraft();
    draft.tools.python = true;
    const config = buildConfigFromDraft(draft);
    assert.equal(config.tools?.groups?.python?.enabled, true);
    assert.equal(config.tools?.groups?.fileInspection?.enabled, true);
  });

  it("maps explore default model only when explore tools are enabled", () => {
    const draft = createDefaultDraft();
    draft.defaultExploreProvider = "openai-codex";
    draft.defaultExploreModel = "gpt-5-codex";
    draft.defaultExploreThinking = "low";

    let config = buildConfigFromDraft(draft);
    assert.equal(config.agent.defaultExploreModel, undefined);

    draft.tools.explore = true;
    config = buildConfigFromDraft(draft);
    assert.equal(config.agent.defaultExploreModel, undefined);

    draft.exploreModelProfileId = "explore_profile";
    config = buildConfigFromDraft(draft);
    assert.deepEqual(config.agent.defaultExploreModel, {
      provider: "openai-codex",
      model: "gpt-5-codex",
      thinkingLevel: "low",
    });
  });

  it("omits explore auth refs when explore tools are disabled", () => {
    const draft = createDefaultDraft();
    draft.mainModelProfileId = "main_profile";
    draft.exploreModelProfileId = "explore_profile";
    draft.defaultExploreProvider = "openai-codex";
    draft.defaultExploreModel = "gpt-5-codex";

    let result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.auth?.exploreModelProfileId, undefined);

    draft.tools.explore = true;
    result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.auth?.exploreModelProfileId, "explore_profile");
  });

  it("maps controller disconnect policy into partial manager-owned config", () => {
    const draft = createDefaultDraft();
    draft.disconnectExitAfterSeconds = "45";
    let config = buildConfigFromDraft(draft);
    assert.deepEqual(config.controller, {
      disconnectPolicy: { mode: "exit_self", exitAfterMs: 45_000 },
    });

    draft.disconnectPolicyMode = "stay_reconnecting";
    config = buildConfigFromDraft(draft);
    assert.deepEqual(config.controller, {
      disconnectPolicy: { mode: "stay_reconnecting" },
    });
  });

  it("omits security config when network and firewall controls use runtime defaults", () => {
    const config = buildConfigFromDraft(createDefaultDraft());
    assert.equal(config.security, undefined);
  });

  it("maps network and firewall security policy controls", () => {
    const draft = createDefaultDraft();
    draft.securityNetworkDefault = "deny";
    draft.securityNetworkAllow =
      "api.anthropic.com, github.com\nregistry.npmjs.org";
    draft.securityNetworkDeny = "metadata.google.internal";
    draft.securityNetworkPackageRegistryHosts =
      "registry.npmjs.org\npypi.org, files.pythonhosted.org";
    draft.securityNetworkDns = "controller";
    draft.securityFirewallEnabled = "true";
    draft.securityFirewallBackend = "nftables";
    draft.securityFirewallEnforceBootPhaseNetwork = "false";

    const config = buildConfigFromDraft(draft);
    assert.deepEqual(config.security, {
      network: {
        default: "deny",
        allow: ["api.anthropic.com", "github.com", "registry.npmjs.org"],
        deny: ["metadata.google.internal"],
        packageRegistryHosts: [
          "registry.npmjs.org",
          "pypi.org",
          "files.pythonhosted.org",
        ],
        dns: "controller",
      },
      firewall: {
        enabled: true,
        backend: "nftables",
        enforceBootPhaseNetwork: false,
      },
    });
  });

  it("serializes create config input YAML from form defaults", () => {
    const draft = createDefaultDraft();
    draft.labels = "team=core";
    const yaml = configInputToYaml(buildConfigFromDraft(draft));

    assert.match(yaml, /version: 1/);
    assert.match(yaml, /agent:/);
    assert.match(yaml, /controller:/);
    assert.match(yaml, /tools:/);

    const parsed = sandboxCreateConfigInputSchema.parse(parseYaml(yaml));
    assert.equal(parsed.agent.defaultModel.provider, "anthropic");
    assert.equal(parsed.agent.defaultModel.model, "claude-sonnet-4-5");
    assert.deepEqual(parsed.controller?.disconnectPolicy, {
      mode: "exit_self",
      exitAfterMs: 300_000,
    });
    assert.equal(parsed.tools?.groups?.shell?.enabled, true);
    assert.equal(parsed.tools?.groups?.python?.enabled, false);
    assert.equal("identity" in parsed, false);
  });

  it("omits boot config by default", () => {
    const config = buildConfigFromDraft(createDefaultDraft());
    assert.equal(config.boot, undefined);
  });

  it("maps single script boot config with boot-level defaults", () => {
    const draft = createDefaultDraft();
    draft.bootEnabled = true;
    draft.bootMode = "single";
    draft.bootScript =
      "git clone https://example.test/repo.git .\npnpm install";
    draft.bootTimeoutSeconds = "120";
    draft.bootRunAs = "root";
    draft.bootNetwork = "package_registries_only";
    draft.bootOnFailure = "continue_readonly";

    const config = buildConfigFromDraft(draft);
    assert.deepEqual(config.boot, {
      script: "git clone https://example.test/repo.git .\npnpm install",
      timeoutMs: 120_000,
      runAs: "root",
      network: "package_registries_only",
      onFailure: "continue_readonly",
    });
  });

  it("maps phased boot config in order with per-phase overrides", () => {
    const draft = createDefaultDraft();
    const setup = createDefaultBootPhase(0);
    setup.id = "phase_setup";
    setup.name = "setup";
    setup.script = "echo setup";
    setup.timeoutSeconds = "30";
    setup.runAs = "root";
    setup.network = "deny";
    const install = createDefaultBootPhase(1);
    install.id = "phase_install";
    install.name = "install";
    install.script = "pnpm install";
    install.network = "package_registries_only";
    draft.bootEnabled = true;
    draft.bootMode = "phases";
    draft.bootTimeoutSeconds = "600";
    draft.bootPhases = [setup, install];

    const config = buildConfigFromDraft(draft);
    assert.deepEqual(config.boot?.phases, [
      {
        name: "setup",
        script: "echo setup",
        timeoutMs: 30_000,
        runAs: "root",
        network: "deny",
      },
      {
        name: "install",
        script: "pnpm install",
        network: "package_registries_only",
      },
    ]);
  });

  it("maps boot phase secret environment rows to secret refs", () => {
    const draft = createDefaultDraft();
    const phase = createDefaultBootPhase(0);
    phase.script = "echo setup";
    phase.env = [
      {
        ...createDefaultBootSecretEnv(),
        id: "env_token",
        name: "TOKEN",
        refType: "env",
        value: "HOST_TOKEN",
      },
      {
        ...createDefaultBootSecretEnv(),
        id: "env_config",
        name: "CONFIG_FILE",
        refType: "file",
        value: "/run/secrets/config",
      },
      {
        ...createDefaultBootSecretEnv(),
        id: "env_api_key",
        name: "API_KEY",
        refType: "kv",
        value: "api-key",
        store: "sandbox-secrets",
        version: "v2",
      },
    ];
    draft.bootEnabled = true;
    draft.bootMode = "phases";
    draft.bootPhases = [phase];

    const config = buildConfigFromDraft(draft);
    assert.deepEqual(config.boot?.phases?.[0]?.env, {
      TOKEN: { env: "HOST_TOKEN" },
      CONFIG_FILE: { file: "/run/secrets/config" },
      API_KEY: {
        kv: { store: "sandbox-secrets", key: "api-key", version: "v2" },
      },
    });
  });

  it("reports boot draft validation errors in create request results", () => {
    const emptySingle = createDefaultDraft();
    emptySingle.bootEnabled = true;
    emptySingle.bootMode = "single";
    let result = buildCreateRequest(emptySingle);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Boot script is required/);

    const noPhases = createDefaultDraft();
    noPhases.bootEnabled = true;
    noPhases.bootMode = "phases";
    result = buildCreateRequest(noPhases);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /at least one boot phase/);

    const duplicatePhases = createDefaultDraft();
    const first = createDefaultBootPhase(0);
    first.name = "setup";
    first.script = "echo one";
    const second = createDefaultBootPhase(1);
    second.name = "setup";
    second.script = "echo two";
    duplicatePhases.bootEnabled = true;
    duplicatePhases.bootMode = "phases";
    duplicatePhases.bootPhases = [first, second];
    result = buildCreateRequest(duplicatePhases);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error, /Duplicate boot phase name: setup/);

    const invalidTimeout = createDefaultDraft();
    invalidTimeout.bootEnabled = true;
    invalidTimeout.bootMode = "single";
    invalidTimeout.bootScript = "echo setup";
    invalidTimeout.bootTimeoutSeconds = "0";
    result = buildCreateRequest(invalidTimeout);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Boot timeout/);

    const invalidPhaseTimeout = createDefaultDraft();
    const phase = createDefaultBootPhase(0);
    phase.script = "echo setup";
    phase.timeoutSeconds = "abc";
    invalidPhaseTimeout.bootEnabled = true;
    invalidPhaseTimeout.bootMode = "phases";
    invalidPhaseTimeout.bootPhases = [phase];
    result = buildCreateRequest(invalidPhaseTimeout);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Boot phase 1 timeout/);
  });

  it("reports disconnect policy validation errors in create request results", () => {
    const draft = createDefaultDraft();
    draft.disconnectExitAfterSeconds = "0";
    let result = buildCreateRequest(draft);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Disconnect shutdown timeout/);

    draft.disconnectExitAfterSeconds = "";
    result = buildCreateRequest(draft);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error, /Disconnect shutdown timeout is required/);
  });

  it("reports an error for invalid YAML config", () => {
    const draft = createDefaultDraft();
    draft.yamlDirty = true;
    draft.yamlSource = "config: [not valid";
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error, /YAML sandbox config is invalid/);
  });

  it("accepts valid sandbox-agent YAML config with launch fields outside YAML", () => {
    const draft = createDefaultDraft();
    draft.image = "custom-agent:latest";
    draft.startAfterCreate = false;
    draft.mainModelProfileId = "profile_1";
    draft.yamlDirty = true;
    draft.yamlSource = validSandboxConfigYaml("sbx_yaml");
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.launch?.image, "custom-agent:latest");
    assert.equal(result.request.start, false);
    assert.equal(result.request.auth, undefined);
    assert.equal(result.request.launch?.sandboxId, draft.sandboxId);
    assert.equal(
      result.request.config.agent.defaultModel.provider,
      "anthropic",
    );
    assert.equal(
      result.request.config.agent.defaultModel.model,
      "claude-sonnet-4-5",
    );
  });

  it("round-trips sandbox config through YAML", () => {
    const yaml = configToYaml(
      parseSandboxConfigYaml(validSandboxConfigYaml("sbx_yaml")),
    );
    const parsed = parseSandboxConfigYaml(yaml);
    assert.equal("identity" in parsed, false);
    assert.equal(parsed.agent.defaultModel.provider, "anthropic");
    assert.equal(parsed.agent.defaultModel.model, "claude-sonnet-4-5");
    assert.deepEqual(parsed.controller.auth.apiKey, {
      file: "/secrets/controller-token",
    });
  });

  it("persists reusable preferences without reusing identity or YAML", () => {
    const storage = new MemoryStorage();
    const draft = createDefaultDraft();
    const phase = createDefaultBootPhase(0);
    const originalPhaseId = phase.id;
    const env = createDefaultBootSecretEnv();
    const originalEnvId = env.id;

    phase.name = "install";
    phase.script = "pnpm install";
    phase.timeoutSeconds = "77";
    phase.runAs = "root";
    phase.network = "deny";
    env.name = "API_TOKEN";
    env.refType = "kv";
    env.value = "api-token";
    env.store = "sandbox-secrets";
    env.version = "v2";
    phase.env = [env];

    draft.name = "custom-name";
    draft.sandboxId = "custom-id";
    draft.image = "custom-image:latest";
    draft.labels = "team=ops";
    draft.backend = "podman";
    draft.memoryMb = "6144";
    draft.vcpu = "1.5";
    draft.startAfterCreate = false;
    draft.defaultProvider = "openai";
    draft.defaultModel = "gpt-5.1-codex-max";
    draft.defaultThinking = "medium";
    draft.defaultExploreProvider = "anthropic";
    draft.defaultExploreModel = "claude-opus-4-5";
    draft.defaultExploreThinking = "high";
    draft.mode = "planning";
    draft.permissionLevel = "read_only";
    draft.disconnectPolicyMode = "stay_reconnecting";
    draft.disconnectExitAfterSeconds = "120";
    draft.securityNetworkDefault = "deny";
    draft.securityNetworkAllow = "api.openai.com, github.com";
    draft.securityNetworkDeny = "metadata.google.internal";
    draft.securityNetworkPackageRegistryHosts = "registry.npmjs.org";
    draft.securityNetworkDns = "controller";
    draft.securityFirewallEnabled = "true";
    draft.securityFirewallBackend = "proxy";
    draft.securityFirewallEnforceBootPhaseNetwork = "false";
    draft.tools.python = true;
    draft.tools.web = true;
    draft.tools.explore = true;
    draft.mainModelProfileId = "model_profile";
    draft.exploreModelProfileId = "explore_profile";
    draft.githubProfileId = "github_profile";
    draft.bootEnabled = true;
    draft.bootMode = "phases";
    draft.bootScript = "echo reusable setup";
    draft.bootTimeoutSeconds = "42";
    draft.bootRunAs = "root";
    draft.bootNetwork = "package_registries_only";
    draft.bootOnFailure = "continue_readonly";
    draft.bootPhases = [phase];
    draft.yamlSource = "config: {}";
    draft.yamlDirty = true;

    saveCreateSandboxPreferences(draft, storage);
    const stored =
      storage.getItem(CREATE_SANDBOX_PREFERENCES_STORAGE_KEY) ?? "";
    assert.equal(stored.includes("custom-name"), false);
    assert.equal(stored.includes("custom-id"), false);
    assert.equal(stored.includes("yamlSource"), false);
    assert.equal(stored.includes("config: {}"), false);
    assert.equal(stored.includes("bootScript"), true);
    assert.equal(stored.includes("bootPhases"), true);
    assert.equal(stored.includes("echo reusable setup"), true);
    const restored = createDraftFromStoredPreferences(storage);

    assert.notEqual(restored.name, "custom-name");
    assert.notEqual(restored.sandboxId, "custom-id");
    assert.match(restored.name, /^[a-z]+-[a-z]+-[a-z]+$/);
    assert.equal(restored.image, "custom-image:latest");
    assert.equal(restored.backend, "podman");
    assert.equal(restored.labels, "team=ops");
    assert.equal(restored.memoryMb, "6144");
    assert.equal(restored.vcpu, "1.5");
    assert.equal(restored.startAfterCreate, false);
    assert.equal(restored.defaultProvider, "openai");
    assert.equal(restored.defaultModel, "gpt-5.1-codex-max");
    assert.equal(restored.defaultThinking, "medium");
    assert.equal(restored.defaultExploreProvider, "anthropic");
    assert.equal(restored.defaultExploreModel, "claude-opus-4-5");
    assert.equal(restored.defaultExploreThinking, "high");
    assert.equal(restored.mode, "planning");
    assert.equal(restored.permissionLevel, "read_only");
    assert.equal(restored.disconnectPolicyMode, "stay_reconnecting");
    assert.equal(restored.disconnectExitAfterSeconds, "120");
    assert.equal(restored.securityNetworkDefault, "deny");
    assert.equal(restored.securityNetworkAllow, "api.openai.com, github.com");
    assert.equal(restored.securityNetworkDeny, "metadata.google.internal");
    assert.equal(
      restored.securityNetworkPackageRegistryHosts,
      "registry.npmjs.org",
    );
    assert.equal(restored.securityNetworkDns, "controller");
    assert.equal(restored.securityFirewallEnabled, "true");
    assert.equal(restored.securityFirewallBackend, "proxy");
    assert.equal(restored.securityFirewallEnforceBootPhaseNetwork, "false");
    assert.equal(restored.tools.python, true);
    assert.equal(restored.tools.web, true);
    assert.equal(restored.tools.explore, true);
    assert.equal(restored.mainModelProfileId, "model_profile");
    assert.equal(restored.exploreModelProfileId, "explore_profile");
    assert.equal(restored.githubProfileId, "github_profile");
    assert.equal(restored.bootEnabled, true);
    assert.equal(restored.bootMode, "phases");
    assert.equal(restored.bootScript, "echo reusable setup");
    assert.equal(restored.bootTimeoutSeconds, "42");
    assert.equal(restored.bootRunAs, "root");
    assert.equal(restored.bootNetwork, "package_registries_only");
    assert.equal(restored.bootOnFailure, "continue_readonly");
    assert.equal(restored.bootPhases.length, 1);
    assert.notEqual(restored.bootPhases[0]?.id, originalPhaseId);
    assert.equal(restored.bootPhases[0]?.name, "install");
    assert.equal(restored.bootPhases[0]?.script, "pnpm install");
    assert.equal(restored.bootPhases[0]?.timeoutSeconds, "77");
    assert.equal(restored.bootPhases[0]?.runAs, "root");
    assert.equal(restored.bootPhases[0]?.network, "deny");
    assert.equal(restored.bootPhases[0]?.env.length, 1);
    assert.notEqual(restored.bootPhases[0]?.env[0]?.id, originalEnvId);
    assert.equal(restored.bootPhases[0]?.env[0]?.name, "API_TOKEN");
    assert.equal(restored.bootPhases[0]?.env[0]?.refType, "kv");
    assert.equal(restored.bootPhases[0]?.env[0]?.value, "api-token");
    assert.equal(restored.bootPhases[0]?.env[0]?.store, "sandbox-secrets");
    assert.equal(restored.bootPhases[0]?.env[0]?.version, "v2");
    assert.equal(restored.yamlSource, "");
    assert.equal(restored.yamlDirty, false);
  });

  it("ignores corrupt stored preferences", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "nerve.sandboxManager.createSandboxPreferences",
      "not-json",
    );
    const draft = createDraftFromStoredPreferences(storage);
    assert.equal(draft.permissionLevel, "autonomous");
    assert.equal(draft.defaultThinking, "off");
    assert.equal(draft.disconnectPolicyMode, "exit_self");
    assert.match(draft.sandboxId, /^[a-z]+-[a-z]+-[a-z]+$/);
  });
});
