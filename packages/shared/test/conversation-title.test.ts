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

  it("skips low-information image openers and uses later request text", () => {
    assert.equal(
      deriveConversationTitle(
        [
          "See /tmp/nerve/image-20260607T132414Z.png",
          "",
          "Sometime it takes time to generate edit and write tool calls. Because LLM needs to generate significant amount of tokens for that. Because of streaming token by token make things slow we show this Preparing tool call rendering for those. I think we should show the similar UI to the write and edit tool call and show the number of lines generated at realtime until the toolcall being completed generated.",
          "",
          "What do you think? The preparing tool call make it hard to identify which tool call it is.",
        ].join("\n"),
      ),
      "Show similar UI for write and edit tool calls and show the number…",
    );
  });

  it("falls back to image review for image-only prompts", () => {
    assert.equal(
      deriveConversationTitle("See /tmp/nerve/image-20260607T132414Z.png"),
      "Image Review",
    );
  });

  it("falls back to file review for file-only prompts", () => {
    assert.equal(
      deriveConversationTitle("Please review packages/web/src/App.svelte"),
      "File Review",
    );
  });

  it("falls back to link review for link-only prompts", () => {
    assert.equal(
      deriveConversationTitle("See https://example.test/foo"),
      "Link Review",
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

  it("falls back for code-only prompts", () => {
    assert.equal(
      deriveConversationTitle("```ts\nconst x = 1;\n```"),
      "New Conversation",
    );
  });

  it("falls back to file review for code/path-only prompts", () => {
    assert.equal(
      deriveConversationTitle(
        "/home/tlm/Projects/pi/nerve/packages/web/src/App.svelte\n```ts\nconst x = 1;\n```",
      ),
      "File Review",
    );
  });
});
