import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConfigFromDraft,
  buildCreateRequest,
  CREATE_SANDBOX_PREFERENCES_STORAGE_KEY,
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
    "identity:",
    `  sandboxId: ${sandboxId}`,
    "agent:",
    "  mainModel:",
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
    assert.equal(draft.initialPrompt, "");
    assert.equal(draft.mainThinking, "off");
    assert.equal(draft.name, draft.sandboxId);
    assert.match(draft.name, /^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("builds a valid request omitting the controller", () => {
    const draft = createDefaultDraft();
    draft.name = "demo";
    draft.labels = "team=core, env=dev";
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.name, undefined);
    assert.equal(result.request.config.identity?.name, "demo");
    assert.equal(result.request.start, true);
    assert.equal(result.request.config.agent.mainModel.provider, "anthropic");
    assert.equal(result.request.config.agent.mainModel.thinkingLevel, "off");
    assert.deepEqual(result.request.config.identity?.labels, {
      team: "core",
      env: "dev",
    });
    // Controller is manager-owned and omitted by the UI.
    assert.equal("controller" in result.request.config, false);
  });

  it("maps the selected thinking level into the main model config", () => {
    const draft = createDefaultDraft();
    draft.mainThinking = "high";
    const config = buildConfigFromDraft(draft);
    assert.equal(config.agent.mainModel.thinkingLevel, "high");
  });

  it("maps tool toggles into tool groups", () => {
    const draft = createDefaultDraft();
    draft.tools.python = true;
    const config = buildConfigFromDraft(draft);
    assert.equal(config.tools?.groups?.python?.enabled, true);
    assert.equal(config.tools?.groups?.fileInspection?.enabled, true);
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
    assert.equal(result.request.image, "custom-agent:latest");
    assert.equal(result.request.start, false);
    assert.equal(result.request.auth, undefined);
    assert.equal(result.request.config.identity?.sandboxId, "sbx_yaml");
    assert.equal(result.request.config.agent.mainModel.provider, "anthropic");
    assert.equal(
      result.request.config.agent.mainModel.model,
      "claude-sonnet-4-5",
    );
  });

  it("round-trips sandbox config through YAML", () => {
    const yaml = configToYaml(
      parseSandboxConfigYaml(validSandboxConfigYaml("sbx_yaml")),
    );
    const parsed = parseSandboxConfigYaml(yaml);
    assert.equal(parsed.identity?.sandboxId, "sbx_yaml");
    assert.equal(parsed.agent.mainModel.provider, "anthropic");
    assert.equal(parsed.agent.mainModel.model, "claude-sonnet-4-5");
    assert.deepEqual(parsed.controller.auth.apiKey, {
      file: "/secrets/controller-token",
    });
  });

  it("persists reusable preferences without reusing identity or YAML", () => {
    const storage = new MemoryStorage();
    const draft = createDefaultDraft();
    draft.name = "custom-name";
    draft.sandboxId = "custom-id";
    draft.image = "custom-image:latest";
    draft.labels = "team=ops";
    draft.startAfterCreate = false;
    draft.mainProvider = "openai";
    draft.mainModel = "gpt-5.1-codex-max";
    draft.mainThinking = "medium";
    draft.initialPrompt = "Keep this prompt";
    draft.mode = "planning";
    draft.permissionLevel = "read_only";
    draft.tools.python = true;
    draft.tools.web = true;
    draft.mainModelProfileId = "model_profile";
    draft.githubProfileId = "github_profile";
    draft.bootEnabled = true;
    draft.bootMode = "single";
    draft.bootScript = "echo workspace-specific setup";
    draft.bootTimeoutSeconds = "42";
    draft.bootPhases = [createDefaultBootPhase(0)];
    draft.yamlSource = "config: {}";
    draft.yamlDirty = true;

    saveCreateSandboxPreferences(draft, storage);
    const stored =
      storage.getItem(CREATE_SANDBOX_PREFERENCES_STORAGE_KEY) ?? "";
    assert.equal(stored.includes("bootScript"), false);
    assert.equal(stored.includes("bootPhases"), false);
    assert.equal(stored.includes("workspace-specific setup"), false);
    const restored = createDraftFromStoredPreferences(storage);

    assert.notEqual(restored.name, "custom-name");
    assert.notEqual(restored.sandboxId, "custom-id");
    assert.match(restored.name, /^[a-z]+-[a-z]+-[a-z]+$/);
    assert.equal(restored.image, "custom-image:latest");
    assert.equal(restored.labels, "team=ops");
    assert.equal(restored.startAfterCreate, false);
    assert.equal(restored.mainProvider, "openai");
    assert.equal(restored.mainModel, "gpt-5.1-codex-max");
    assert.equal(restored.mainThinking, "medium");
    assert.equal(restored.initialPrompt, "Keep this prompt");
    assert.equal(restored.mode, "planning");
    assert.equal(restored.permissionLevel, "read_only");
    assert.equal(restored.tools.python, true);
    assert.equal(restored.tools.web, true);
    assert.equal(restored.mainModelProfileId, "model_profile");
    assert.equal(restored.githubProfileId, "github_profile");
    assert.equal(restored.bootEnabled, false);
    assert.equal(restored.bootMode, "single");
    assert.equal(restored.bootScript, "");
    assert.equal(restored.bootTimeoutSeconds, "600");
    assert.deepEqual(restored.bootPhases, []);
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
    assert.equal(draft.mainThinking, "off");
    assert.match(draft.sandboxId, /^[a-z]+-[a-z]+-[a-z]+$/);
  });
});
