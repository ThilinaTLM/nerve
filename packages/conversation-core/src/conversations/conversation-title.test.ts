import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveConversationTitle } from "./conversation-title.js";

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
    assert.ok(Array.from(title).length <= 100);
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
      "example.com/docs",
    );
    assert.equal(deriveConversationTitle("./screenshot.png"), "Image Review");
    assert.equal(deriveConversationTitle("  ?  "), "New Conversation");
  });
});

// Proposal summary, acceptance, Composer mentions, and path tables.
const proposalCases: [string, string][] = [
  [
    "Review changes in https://github.com/ThilinaTLM/nerve/pull/459",
    "Review changes in PR ThilinaTLM/nerve#459",
  ],
  ["Review ThilinaTLM/nerve#459", "Review ThilinaTLM/nerve#459"],
  ["https://github.com/acme/api/issues/9", "Issue acme/api#9"],
  [
    "Investigate https://acme.atlassian.net/browse/PAY-123",
    "Investigate PAY-123",
  ],
  [
    "Compare packages/client/src/config.ts and packages/server/src/config.ts",
    "Compare client/src/config.ts and server/src/config.ts",
  ],
  [
    "Read https://docs.stripe.com/webhooks/signatures and update our handler",
    "Read docs.stripe.com/webhooks/signatures and update our handler",
  ],
  [
    "Fix packages/ui/src/button.svelte focus ring",
    "Fix button.svelte focus ring",
  ],
  ["https://github.com/ThilinaTLM/nerve/pull/459", "PR ThilinaTLM/nerve#459"],
  [
    "Review https://github.com/acme/api/pull/12/files#diff-abc",
    "Review PR acme/api#12",
  ],
  [
    "Review https://github.com/acme/api/pull/12 and https://github.com/acme/api/pull/12/files",
    "Review PR acme/api#12",
  ],
  [
    "Compare https://github.com/acme/api/pull/12 with https://github.com/acme/web/pull/34",
    "Compare PR acme/api#12 with PR acme/web#34",
  ],
  [
    "Check whether https://github.com/acme/api/pull/12 fixes https://github.com/acme/api/issues/9",
    "Check whether PR acme/api#12 fixes issue acme/api#9",
  ],
  [
    "Review https://github.com/acme/api/pull/12 but do not merge it",
    "Review PR acme/api#12 but do not merge it",
  ],
  [
    "Review https://github.com/acme/api/pull/12.\nFor background see https://github.com/acme/api/issues/9.",
    "Review PR acme/api#12",
  ],
  [
    "Review [Fix checkout timeout](https://github.com/acme/api/pull/12)",
    "Review PR acme/api#12: Fix checkout timeout",
  ],
  [
    "Review [this](https://github.com/acme/api/pull/12)",
    "Review PR acme/api#12",
  ],
  ["Review #459", "Review #459"],
  ["Fix PAY-123 checkout timeout", "Fix PAY-123 checkout timeout"],
  [
    "Review https://github.acme.internal/platform/server/pull/42",
    "Review github.acme.internal/platform/server",
  ],
  [
    "Review https://github.com.evil.io/acme/api/pull/1",
    "Review github.com.evil.io/acme/api",
  ],
  ["Open https://user:secret@example.com/a?token=abc", "Open example.com/a"],
  [
    "Review https://github.com/acme/api/pull/459-invalid",
    "Review github.com/acme/api",
  ],
  ["Fix the HTTP-500 on login", "Fix the HTTP-500 on login"],
];

describe("conversation title proposal", () => {
  for (const [prompt, expected] of proposalCases) {
    it(prompt, () => assert.equal(deriveConversationTitle(prompt), expected));
  }
});

const mentionCases: [string, string][] = [
  [
    "@image-20261019T173104Z.png Shall we remove the outline from our button",
    "Remove the outline from our button",
  ],
  [
    "@image-20261019T154725Z.png @image-20261019T154740Z.png Are these two pull requests related?",
    "Are these two pull requests related?",
  ],
  ["@queued-compaction.md Review this", "Review queued-compaction.md"],
  [
    "@proposals/ Review these and identify which are implemented",
    "Review proposals/ and identify which are implemented",
  ],
];
describe("Composer mentions proposal", () => {
  for (const [prompt, expected] of mentionCases) {
    it(prompt, () => assert.equal(deriveConversationTitle(prompt), expected));
  }
});

const referenceEdgeCases: [string, string][] = [
  [
    "Fix packages/ui/src/button.svelte. For background see docs/context.md.",
    "Fix button.svelte",
  ],
  ["@packages/ui/src/button.svelte Review this", "Review button.svelte"],
  [
    "Review https://github.com/acme/api/pull/1, https://github.com/acme/api/pull/2 and https://github.com/acme/api/pull/3",
    "Review PR acme/api#1, PR acme/api#2 and PR acme/api#3",
  ],
  ["@image-utils.png Review this", "Review image-utils.png"],
  [
    "Review https://www.github.com/acme/api/pull/12/checks?token=secret",
    "Review PR acme/api#12",
  ],
  [
    "https://github.com/acme/api/commit/0123456789abcdef",
    "Commit acme/api@0123456",
  ],
  [
    "Check https://github.com/acme/api/commit/0123456789abcdef",
    "Check commit acme/api@0123456",
  ],
  [
    "Review https://github.com/acme/api/pull/12?x=1, https://github.com/acme/api/pull/12/files#diff",
    "Review PR acme/api#12",
  ],
  ["Review <https://github.com/acme/api/pull/12>", "Review PR acme/api#12"],
  ["Review `https://github.com/acme/api/pull/12`", "Review PR acme/api#12"],
  [
    "Review [PR acme/api#12](https://github.com/acme/api/pull/12)",
    "Review PR acme/api#12",
  ],
  [
    "Open https://user:pw@internal.acme.dev:8443/x?token=secret#private",
    "Open internal.acme.dev:8443/x",
  ],
  [
    "Open https://www.example.com:443/docs/guide",
    "Open example.com/docs/guide",
  ],
  [
    "Open https://drive.google.com/file/d/1AbC123/view",
    "Open drive.google.com/file",
  ],
  ["Open https://example.com/123456789/secret", "Open example.com"],
  ["Open https://example.com/a%40token/secret", "Open example.com"],
  [
    "Investigate https://acme.atlassian.net/jira/browse/PAY-123?secret=x",
    "Investigate PAY-123",
  ],
  ["Review this @queued-compaction.md", "Review queued-compaction.md"],
  ["@image-20261019T173104Z.png", "Image Review"],
  ["@pasted-file-20261019T173104Z.txt", "File Review"],
  ["![Screenshot](https://example.com/image.png)", "Image Review"],
  ["Review https://[bad", "Link Review"],
  [
    "Compare a/b/client/src/config.ts and z/b/server/src/config.ts",
    "Compare client/src/config.ts and server/src/config.ts",
  ],
  [
    "Compare a/shared/src/config.ts and b/shared/src/config.ts",
    "Compare shared/src/config.ts and shared/src/config.ts",
  ],
  [
    "Review " +
      [1, 2, 3, 4, 5]
        .map((n) => `https://github.com/acme/api/pull/${n}`)
        .join(", "),
    "Review PR acme/api#1, PR acme/api#2 and 3 more",
  ],
  [
    "Review " +
      [1, 2, 3, 4]
        .map((n) => `https://github.com/acme/api/pull/${n}`)
        .join(" with "),
    "Review PR acme/api#1 with PR acme/api#2 and 2 more",
  ],
];

describe("Composer instructions and leading filler", () => {
  const cases: [string, string][] = [
    [
      "Review the implementation using @skill:team-lead",
      "Review the implementation using",
    ],
    [
      "@command:review Please inspect the settings page",
      "Inspect the settings page",
    ],
    [
      "Review the implementation using @notes:design.md",
      "Review the implementation using",
    ],
    ["Review this @notes:design/file.md", "Review file.md"],
    ["Review this @notes:design\\file.md", "Review file.md"],
    [
      "Looks better we should use cursor pointer. Btw we can do the implementation use @skill:team-lead",
      "Looks better we should use cursor pointer",
    ],
  ];
  for (const [prompt, expected] of cases) {
    it(prompt, () => assert.equal(deriveConversationTitle(prompt), expected));
  }
  for (const prefix of [
    "Btw",
    "By the way",
    "Ok",
    "Okay",
    "Also",
    "Btw,",
    "By the way,",
    "Okay, also,",
  ]) {
    it(`removes leading filler: ${prefix}`, () => {
      assert.equal(
        deriveConversationTitle(`${prefix} please review the settings page`),
        "Review the settings page",
      );
    });
  }
});

describe("protected reference edge cases", () => {
  for (const [prompt, expected] of referenceEdgeCases) {
    it(prompt, () => assert.equal(deriveConversationTitle(prompt), expected));
  }

  it("keeps an identifier whole near the hard ceiling and drops a trailing label first", () => {
    const reference = "PR acme/api#123456789";
    const title = deriveConversationTitle(
      `Review the unusually complicated authentication and authorization implementation for https://github.com/acme/api/pull/123456789`,
    );
    assert.ok(Array.from(title).length <= 100);
    assert.ok(title.endsWith(reference), title);
    assert.equal(
      deriveConversationTitle(
        `Review [${"lengthy descriptive label ".repeat(8)}](https://github.com/acme/api/pull/12)`,
      ),
      "Review PR acme/api#12",
    );
    assert.equal(
      deriveConversationTitle(
        `Review https://github.com/acme/api/pull/12 and ${"additional background context ".repeat(8)}`,
      ),
      "Review PR acme/api#12",
    );
  });

  it("cuts only on grapheme boundaries", () => {
    for (const grapheme of ["👩🏽‍💻", "e\u0301"]) {
      const prefix = `Improve ${"a".repeat(83)}`;
      const title = deriveConversationTitle(prefix + grapheme.repeat(10));
      assert.ok(Array.from(title).length <= 100);
      assert.ok(title.startsWith(prefix));
      assert.equal(title.slice(prefix.length).split(grapheme).join(""), "");
    }
  });

  it("bounds pasted logs and ignores code, including an unfinished fence", () => {
    assert.equal(
      deriveConversationTitle(
        `Please fix login failures.\n\`\`\`\n${"ERROR: https://github.com/acme/api/pull/12\n".repeat(100_000)}`,
      ),
      "Fix login failures",
    );
    assert.equal(
      deriveConversationTitle("```\n" + "error log ".repeat(100_000)),
      "New Conversation",
    );
  });

  it("never throws on malformed or sentinel-like input", () => {
    for (const input of [
      "https://%",
      "https://[::",
      "https://",
      "\uE000999\uE001",
      "\ud800",
      "[broken](https://[bad)",
      "@",
      "~~~\nunfinished",
    ]) {
      const title = deriveConversationTitle(input);
      assert.ok(Array.from(title).length <= 100);
      assert.doesNotMatch(title, /[\uE000\uE001]/u);
    }
  });
});
