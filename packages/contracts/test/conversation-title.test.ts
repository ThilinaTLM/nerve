import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveConversationTitle } from "../src/domains/conversations/conversation-title.js";

describe("conversation titles", () => {
  it("prefers an actionable request over paths, logs, and execution details", () => {
    assert.equal(
      deriveConversationTitle(
        "$ pnpm test\npackages/workbench-app/src/main.ts:12\nPlease refactor the settings page to make loading clearer.",
      ),
      "Refactor the settings page to make loading clearer",
    );
    assert.equal(
      deriveConversationTitle(
        "```\n$ git status --short\n M src/app.ts\n```\nOpen a pull request for the current work:\n1. Create a branch.\n2. Stage and commit changes.\n3. Push the branch.",
      ),
      "Open a pull request for the current work",
    );
    assert.equal(
      deriveConversationTitle(
        "Use agent-browser core and dogfood skills.\nLogin as a merchant and create a product.",
      ),
      "Login as a merchant and create a product",
    );
    assert.equal(
      deriveConversationTitle(
        "2026-07-19T23:15:38.400+05:30 ERROR 603979 --- startup failed\nPlease report the issue.",
      ),
      "Report the issue",
    );
  });

  it("keeps source-backed identifiers and path basenames without inventing concepts", () => {
    assert.equal(
      deriveConversationTitle("src/auth/login.ts is broken"),
      "Fix login.ts",
    );
    assert.equal(
      deriveConversationTitle(
        "Can you review `AuthService` and its login failures?",
      ),
      "Review AuthService and its login failures",
    );
    assert.equal(
      deriveConversationTitle(
        "Please update getUserData in src/auth/user-service.ts.",
      ),
      "Update getUserData in user-service.ts",
    );
  });

  it("prefers a specific problem statement over a generic follow-up", () => {
    assert.equal(
      deriveConversationTitle(
        "I think the workflow badges we have in README are outofdate? Can you check them?",
      ),
      "Workflow badges we have in README are out of date",
    );
  });

  it("normalizes request prefixes, markdown, and safe English questions", () => {
    assert.equal(
      deriveConversationTitle(
        "## Request\nPlease improve **tool call** error display.",
      ),
      "Improve tool call error display",
    );
    assert.equal(
      deriveConversationTitle("How do I configure auth?"),
      "Configure auth",
    );
  });

  it("preserves non-English source text and bounds Unicode output", () => {
    assert.equal(
      deriveConversationTitle("設定画面の読み込み状態を改善してください。"),
      "設定画面の読み込み状態を改善してください",
    );
    assert.equal(
      deriveConversationTitle(
        "¿Puedes revisar la configuración de autenticación?",
      ),
      "¿Puedes revisar la configuración de autenticación",
    );

    const title = deriveConversationTitle(
      `Please improve ${"😀 multilingual settings ".repeat(8)}without losing context.`,
    );
    assert.ok(Array.from(title).length <= 80);
    assert.equal(/[\uD800-\uDBFF]$/u.test(title), false);
    assert.match(title, /^Improve/u);
  });

  it("uses a meaningful title for greeting-only conversations", () => {
    assert.equal(deriveConversationTitle("Hi"), "General Chat");
    assert.equal(deriveConversationTitle("Hello there 👋"), "General Chat");
    assert.equal(
      deriveConversationTitle("Hi, can you review the settings page?"),
      "Review the settings page",
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
});
