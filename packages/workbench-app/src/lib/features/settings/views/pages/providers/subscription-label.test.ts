import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { subscriptionAccountLabel } from "./subscription-label";

describe("subscriptionAccountLabel", () => {
  it("drops the provider name the row title already shows", () => {
    assert.equal(
      subscriptionAccountLabel("Anthropic", "Anthropic (Claude Pro/Max)"),
      "Claude Pro/Max",
    );
    assert.equal(
      subscriptionAccountLabel("OpenAI Codex", "OpenAI (ChatGPT Plus/Pro)"),
      "ChatGPT Plus/Pro",
    );
  });

  it("hides an account label that only repeats the title", () => {
    assert.equal(
      subscriptionAccountLabel("OpenRouter", "OpenRouter"),
      undefined,
    );
    assert.equal(
      subscriptionAccountLabel("OpenRouter", "openrouter"),
      undefined,
    );
  });

  it("keeps an account label that carries new information", () => {
    assert.equal(
      subscriptionAccountLabel("Anthropic", "person@example.com"),
      "person@example.com",
    );
    assert.equal(
      subscriptionAccountLabel("Anthropic", "Acme Corp (Team)"),
      "Acme Corp (Team)",
    );
  });

  it("has nothing to show without an account", () => {
    assert.equal(subscriptionAccountLabel("Anthropic", undefined), undefined);
    assert.equal(subscriptionAccountLabel("Anthropic", "  "), undefined);
  });
});
