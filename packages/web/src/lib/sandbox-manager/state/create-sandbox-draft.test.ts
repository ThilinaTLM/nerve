import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConfigFromDraft,
  buildCreateRequest,
  createDefaultDraft,
} from "./create-sandbox-draft";

describe("create sandbox draft", () => {
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
    assert.deepEqual(result.request.config.identity?.labels, {
      team: "core",
      env: "dev",
    });
    // Controller is manager-owned and omitted by the UI.
    assert.equal("controller" in result.request.config, false);
  });

  it("maps tool toggles into tool groups", () => {
    const draft = createDefaultDraft();
    draft.tools.python = true;
    const config = buildConfigFromDraft(draft);
    assert.equal(config.tools?.groups?.python?.enabled, true);
    assert.equal(config.tools?.groups?.fileInspection?.enabled, true);
  });

  it("reports an error for invalid advanced JSON config", () => {
    const draft = createDefaultDraft();
    draft.useAdvancedConfig = true;
    draft.advancedConfig = "{ not json";
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, false);
  });

  it("accepts a valid advanced JSON config", () => {
    const draft = createDefaultDraft();
    draft.useAdvancedConfig = true;
    draft.advancedConfig = JSON.stringify({
      version: 1,
      agent: {
        mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
      },
    });
    const result = buildCreateRequest(draft);
    assert.equal(result.ok, true);
  });
});
