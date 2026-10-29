import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { providerMarkId } from "./provider-marks.js";

describe("providerMarkId", () => {
  it("matches known providers and their families", () => {
    assert.equal(providerMarkId("anthropic"), "anthropic");
    assert.equal(providerMarkId("openai-codex"), "openai");
    assert.equal(providerMarkId("azure-openai-responses"), "azure");
    assert.equal(providerMarkId("google-gemini-cli"), "gemini");
    assert.equal(providerMarkId("google-vertex"), "google-cloud");
    assert.equal(providerMarkId("amazon-bedrock"), "aws");
    assert.equal(providerMarkId("kimi-coding"), "kimi");
    assert.equal(providerMarkId("GitHub-Copilot"), "github-copilot");
  });

  it("leaves unknown providers to the generic glyph", () => {
    assert.equal(providerMarkId("nerve-faux"), undefined);
    assert.equal(providerMarkId("acme"), undefined);
  });
});
