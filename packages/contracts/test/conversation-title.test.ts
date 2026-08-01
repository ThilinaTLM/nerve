import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveConversationTitle,
  expandTruncatedConversationTitle,
} from "../src/domains/conversations/title.js";

describe("conversation titles", () => {
  it("prefers an actionable natural-language request over paths and logs", () => {
    assert.equal(
      deriveConversationTitle(
        "$ pnpm test\npackages/workbench-app/src/main.ts:12\nPlease refactor the settings page to make loading clearer.",
      ),
      "Refactor the settings page to make loading clearer.",
    );
  });

  it("uses stable fallbacks for reference-only prompts", () => {
    assert.equal(deriveConversationTitle("src/main.ts"), "File Review");
    assert.equal(
      deriveConversationTitle("https://example.com/docs"),
      "Link Review",
    );
    assert.equal(deriveConversationTitle("./screenshot.png"), "Image Review");
    assert.equal(deriveConversationTitle("  ?  "), "New Conversation");
  });

  it("normalizes markdown and common request prefixes", () => {
    assert.equal(
      deriveConversationTitle(
        "## Request\nPlease improve **tool call** error display.",
      ),
      "Improve tool call error display.",
    );
  });

  it("expands only matching truncated titles", () => {
    const prompt = "Implement resilient protocol heartbeat validation.";
    assert.equal(
      expandTruncatedConversationTitle("Implement resilient protocol…", prompt),
      prompt,
    );
    assert.equal(
      expandTruncatedConversationTitle("Unrelated title…", prompt),
      undefined,
    );
    assert.equal(
      expandTruncatedConversationTitle("Complete title", prompt),
      undefined,
    );
  });
});
