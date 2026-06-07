import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveConversationTitle } from "../src/conversation-title.js";

describe("deriveConversationTitle", () => {
  it("uses the first readable sentence", () => {
    assert.equal(
      deriveConversationTitle(
        "Let's improve the new conversation and conversation name semantics.\n\nHere is the longer proposal.",
      ),
      "Let's improve the new conversation and conversation name semantics.",
    );
  });

  it("strips code fences before choosing a title", () => {
    assert.equal(
      deriveConversationTitle(
        "```ts\nconst title = 'bad';\n```\nCan you make settings clearer?",
      ),
      "Can you make settings clearer?",
    );
  });

  it("removes file paths and urls", () => {
    assert.equal(
      deriveConversationTitle(
        "Please fix packages/web/src/App.svelte:123 and https://example.test/trace. The tabs are broken.",
      ),
      "The tabs are broken.",
    );
  });

  it("truncates long readable prompts cleanly", () => {
    assert.equal(
      deriveConversationTitle(
        "Build a focused onboarding screen that explains projects, conversations, agents, and local tool permissions without overwhelming first-time users.",
      ),
      "Build a focused onboarding screen that explains projects…",
    );
  });

  it("falls back for code/path-only prompts", () => {
    assert.equal(
      deriveConversationTitle(
        "/home/tlm/Projects/pi/nerve/packages/web/src/App.svelte\n```ts\nconst x = 1;\n```",
      ),
      "New Conversation",
    );
  });
});
