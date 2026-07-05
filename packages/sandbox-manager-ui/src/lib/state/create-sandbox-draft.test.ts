import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConfigFromDraft,
  buildCreateRequest,
  createDefaultDraft,
  parseCreateRequestYaml,
  requestToYaml,
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
      "image: nerve-sandbox:dev",
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
    assert.equal(parsed.image, "nerve-sandbox:dev");
    assert.equal(parsed.start, true);
    assert.equal(parsed.auth?.mainModelProfileId, "profile_1");
    assert.equal(parsed.config.agent.mainModel.provider, "anthropic");
    assert.equal(parsed.config.agent.mainModel.model, "claude-sonnet-4-5");
  });
});
