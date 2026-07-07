import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConfigFromDraft,
  buildCreateRequest,
  createDefaultDraft,
  createDraftFromStoredPreferences,
  parseCreateRequestYaml,
  requestToYaml,
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
    assert.equal(result.request.name, "demo");
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

  it("reports an error for invalid YAML config", () => {
    const draft = createDefaultDraft();
    draft.yamlDirty = true;
    draft.yamlSource = "config: [not valid";
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error, /YAML create request is invalid/);
  });

  it("accepts a valid YAML create request", () => {
    const draft = createDefaultDraft();
    draft.yamlDirty = true;
    draft.yamlSource = [
      "config:",
      "  version: 1",
      "  agent:",
      "    mainModel:",
      "      provider: anthropic",
      "      model: claude-sonnet-4-5",
      "image: nerve-sandbox-agent:dev",
      "start: true",
    ].join("\n");
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
  });

  it("round-trips a request through YAML", () => {
    const draft = createDefaultDraft();
    draft.mainModelProfileId = "profile_1";
    draft.name = "demo";
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const yaml = requestToYaml(result.request);
    const parsed = parseCreateRequestYaml(yaml);
    assert.equal(parsed.image, "nerve-sandbox-agent:dev");
    assert.equal(parsed.start, true);
    assert.equal(parsed.auth?.mainModelProfileId, "profile_1");
    assert.equal(parsed.config.agent.mainModel.provider, "anthropic");
    assert.equal(parsed.config.agent.mainModel.model, "claude-sonnet-4-5");
    assert.equal(parsed.config.agent.mainModel.thinkingLevel, "off");
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
    draft.yamlSource = "config: {}";
    draft.yamlDirty = true;

    saveCreateSandboxPreferences(draft, storage);
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
