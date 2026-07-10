import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveToolCallDraft } from "../../state/transcript-types";
import { DRAFT_PREVIEW_LINES, summarizeToolDraft } from "./tool-draft-progress";

function draft(
  toolName: string,
  overrides: Partial<LiveToolCallDraft> = {},
): LiveToolCallDraft {
  return {
    kind: "tool_call_draft",
    key: `live:msg_1:tool-draft:0`,
    runId: "run_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    contentIndex: 0,
    providerToolCallId: "call_1",
    toolName,
    argsText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function previewLines(text: string | undefined): number {
  return text ? text.split("\n").length : 0;
}

describe("summarizeToolDraft", () => {
  it("counts partial write content lines from escaped JSON", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"src/app.ts","content":"one\\ntwo\\nthree',
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.path, "src/app.ts");
    assert.equal(summary.statusText, "Generating");
    assert.equal(summary.lineCount, 3);
    assert.equal(summary.preview, "one\ntwo");
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+3"],
    );
  });

  it("uses progress snapshots for write drafts without raw args", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        progress: {
          path: "src/live.ts",
          lineCount: 12,
          generatedLineCount: 12,
          estimated: true,
        },
      }),
    );

    assert.equal(summary.path, "src/live.ts");
    assert.equal(summary.lineCount, 12);
    assert.equal(summary.generatedLineCount, 12);
    assert.equal(summary.estimated, true);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+12"],
    );
  });

  it("uses progress snapshots for write draft previews without raw args", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        progress: {
          path: "src/live.ts",
          lineCount: 2,
          generatedLineCount: 2,
          generatedPreview: "recent one\nrecent two",
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.preview, "recent one\nrecent two");
  });

  it("tails partial write draft previews to the latest 10 completed lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: `{"path":"src/app.ts","content":"${lines.join("\\n")}`,
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.preview, lines.slice(1, 11).join("\n"));
    assert.equal(summary.preview?.includes("earlier line"), false);
  });

  it("tails progress write draft previews to the latest 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("write", {
        progress: {
          path: "src/live.ts",
          lineCount: 12,
          generatedLineCount: 12,
          generatedPreview: lines.join("\n"),
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.preview, lines.slice(-10).join("\n"));
    assert.equal(summary.preview?.includes("earlier line"), false);
  });

  it("uses final write args for exact path and line count", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"src/old.ts","content":"partial',
        progress: {
          path: "src/live.ts",
          lineCount: 99,
          generatedLineCount: 99,
          estimated: true,
        },
        args: { path: "src/final.ts", content: "one\ntwo" },
        done: true,
      }),
    );

    assert.equal(summary.path, "src/final.ts");
    assert.equal(summary.statusText, "Submitting");
    assert.equal(summary.lineCount, 2);
    assert.equal(summary.preview, "one\ntwo");
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["+2"],
    );
  });

  it("tails final write draft previews to the latest 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("write", {
        args: { path: "src/final.ts", content: lines.join("\n") },
        done: true,
      }),
    );

    assert.equal(summary.path, "src/final.ts");
    assert.equal(summary.lineCount, 12);
    assert.equal(summary.preview, lines.slice(-10).join("\n"));
    assert.equal(summary.preview?.includes("earlier line"), false);
  });

  it("previews partial edit replacements as diff lines", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        argsText:
          '{"replacements":[{"oldText":"old\\nexisting","newText":"new one\\nnew two\\nnew thre',
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.preview, "-old\n-existing\n+new one\n+new two");
    assert.equal(summary.previewLanguage, "diff");
  });

  it("previews partial edit patch lines as diff", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        argsText: '{"path":"x.ts","patch":"@@ -1 +1 @@\\n-old\\n+new',
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.preview, "@@ -1 +1 @@\n-old");
    assert.equal(summary.previewLanguage, "diff");
  });

  it("uses progress snapshots for edit operation drafts without raw args", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        progress: {
          path: "src/live.ts",
          operationCount: 2,
          generatedLineCount: 6,
          estimatedAdditions: 6,
          estimatedDeletions: 4,
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.toolName, "edit");
    assert.equal(summary.path, "src/live.ts");
    assert.equal(summary.operationCount, 2);
    assert.equal(summary.generatedLineCount, 6);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 operations", "+6", "-4"],
    );
  });

  it("uses progress snapshots for edit draft previews without raw args", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        progress: {
          path: "src/live.ts",
          operationCount: 1,
          generatedLineCount: 1,
          estimatedAdditions: 1,
          estimatedDeletions: 1,
          generatedPreview: "-old\n+new",
          generatedPreviewLanguage: "diff",
          estimated: true,
        },
      }),
    );

    assert.equal(summary.kind, "edit");
    assert.equal(summary.preview, "-old\n+new");
    assert.equal(summary.previewLanguage, "diff");
  });

  it("uses final edit shorthand args for operation and generated-line counts", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        args: {
          path: "src/app.ts",
          lineInsertions: [{ line: 1, position: "before", text: "a\nb" }],
          replacements: [{ oldText: "old", newText: "new" }],
          patch: "@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
        },
        done: true,
      }),
    );

    assert.equal(summary.toolName, "edit");
    assert.equal(summary.operationCount, 3);
    assert.equal(summary.generatedLineCount, 5);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["3 operations", "+5", "-2"],
    );
  });

  it("previews final edit replacements with removed and added lines", () => {
    const summary = summarizeToolDraft(
      draft("edit", {
        args: {
          path: "src/app.ts",
          replacements: [{ oldText: "old", newText: "new" }],
        },
        done: true,
      }),
    );

    assert.equal(summary.toolName, "edit");
    assert.equal(summary.preview, "-old\n+new");
    assert.equal(summary.previewLanguage, "diff");
  });

  it("tails final edit diff previews to the latest 10 lines", () => {
    const replacementLines = Array.from(
      { length: 6 },
      (_, index) => `replacement-${index + 1}`,
    );
    const insertionLines = Array.from(
      { length: 4 },
      (_, index) => `insertion-${index + 1}`,
    );
    const patchLines = ["@@ -1 +1 @@", "-removed", "+added"];
    const summary = summarizeToolDraft(
      draft("edit", {
        args: {
          path: "src/app.ts",
          replacements: [
            {
              oldText: "old secret should not render",
              newText: replacementLines.join("\n"),
            },
          ],
          insertions: [{ text: insertionLines.join("\n") }],
          patch: patchLines.join("\n"),
        },
        done: true,
      }),
    );

    const generatedLines = [
      "-old secret should not render",
      ...replacementLines.map((line) => `+${line}`),
      ...insertionLines.map((line) => `+${line}`),
      ...patchLines,
    ];
    assert.equal(summary.toolName, "edit");
    assert.equal(summary.preview, generatedLines.slice(-10).join("\n"));
    assert.equal(summary.previewLanguage, "diff");
    assert.equal(summary.preview?.includes("old secret"), false);
    assert.equal(summary.preview?.includes("earlier line"), false);
  });

  it("shows one-line bash commands inline in the draft header", () => {
    const summary = summarizeToolDraft(
      draft("bash", {
        argsText: '{"command":"pnpm test"',
      }),
    );

    assert.equal(summary.kind, "bash");
    assert.equal(summary.command, "pnpm test");
    assert.equal(summary.inlineInput, "pnpm test");
    assert.equal(summary.inputPreview, undefined);
    assert.equal(summary.inputLineCount, 1);
  });

  it("tails multi-line bash command draft previews to the latest 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `cmd-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("bash", {
        argsText: `{"command":"${lines.join("\\n")}`,
      }),
    );

    assert.equal(summary.kind, "bash");
    assert.equal(summary.inlineInput, undefined);
    assert.equal(summary.inputPreview, lines.slice(-10).join("\n"));
    assert.equal(summary.inputPreview?.includes("omitted"), false);
    assert.equal(summary.inputLineCount, 12);
  });

  it("extracts partial Python code from streamed JSON", () => {
    const summary = summarizeToolDraft(
      draft("python", {
        argsText: '{"code":"import os\\nprint(os.getcwd())',
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, "import os\nprint(os.getcwd())");
    assert.equal(summary.codeLineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 code lines"],
    );
  });

  it("uses final Python args for exact submitted code", () => {
    const summary = summarizeToolDraft(
      draft("python", {
        argsText: '{"code":"partial',
        args: { code: "print('hello')\nprint('done')" },
        done: true,
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, "print('hello')\nprint('done')");
    assert.equal(summary.codeLineCount, 2);
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["2 code lines", "submitted"],
    );
  });

  it("tails multi-line Python draft previews to the latest 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `py-${index + 1}`);
    const summary = summarizeToolDraft(
      draft("python", {
        args: { code: lines.join("\n") },
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.inlineInput, undefined);
    assert.equal(summary.inputPreview, lines.slice(-10).join("\n"));
    assert.equal(summary.inputPreview?.includes("omitted"), false);
    assert.equal(summary.inputLineCount, 12);
  });

  it("summarizes Python file path drafts", () => {
    const summary = summarizeToolDraft(
      draft("python", {
        argsText: '{"path":"scripts/report.py"',
        args: { path: "scripts/report.py" },
        done: true,
      }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.path, "scripts/report.py");
    assert.equal(summary.code, undefined);
    assert.equal(summary.statusText, "Submitting Python file…");
    assert.deepEqual(
      summary.meta.map((item) => item.text),
      ["file", "submitted"],
    );
  });

  it("waits cleanly for early Python drafts before code or path starts", () => {
    const summary = summarizeToolDraft(
      draft("python", { argsText: '{"timeout": 5, "code":' }),
    );

    assert.equal(summary.kind, "python");
    assert.equal(summary.code, undefined);
    assert.equal(summary.statusText, "Waiting for Python code or path…");
    assert.deepEqual(summary.meta, []);
  });

  it("falls back cleanly for malformed partial JSON", () => {
    const summary = summarizeToolDraft(
      draft("write", { argsText: '{"path":"x.ts","content":' }),
    );

    assert.equal(summary.kind, "write");
    assert.equal(summary.path, "x.ts");
    assert.equal(summary.lineCount, undefined);
    assert.deepEqual(summary.meta, []);
  });

  it("relativizes absolute draft paths against the project cwd", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"/home/u/proj/src/app.ts","content":"one\\ntwo',
      }),
      "/home/u/proj",
    );

    assert.equal(summary.path, "src/app.ts");
  });

  it("leaves out-of-cwd draft paths intact", () => {
    const summary = summarizeToolDraft(
      draft("write", {
        argsText: '{"path":"/etc/hosts","content":"x',
      }),
      "/home/u/proj",
    );

    assert.equal(summary.path, "/etc/hosts");
  });

  it("caps final generic tool argument previews to 10 lines", () => {
    const todos = Array.from({ length: 12 }, (_, index) => ({
      todo: `Task ${index + 1}`,
      done: index % 2 === 0,
    }));
    const summary = summarizeToolDraft(
      draft("todos_set", {
        args: { todos },
        done: true,
      }),
    );

    assert.equal(summary.kind, "generic");
    assert.equal(summary.argsPreviewLanguage, "json");
    assert.ok(summary.argsPreview);
    assert.ok(previewLines(summary.argsPreview) <= DRAFT_PREVIEW_LINES);
    assert.match(summary.argsPreview, /Task 12/);
  });

  it("caps partial generic tool argument previews to 10 lines", () => {
    const partialTasks = Array.from(
      { length: 5 },
      (_, index) =>
        `{"task":"Investigate area ${index + 1} in detail","label":"Area ${index + 1}"}`,
    ).join(",");
    const summary = summarizeToolDraft(
      draft("explore", {
        argsText: `{"tasks":[${partialTasks}],"context":"Parent lookup found several relevant files and unresolved details`,
      }),
    );

    assert.equal(summary.kind, "generic");
    assert.equal(summary.argsPreviewLanguage, "json");
    assert.ok(summary.argsPreview);
    assert.ok(previewLines(summary.argsPreview) <= DRAFT_PREVIEW_LINES);
    assert.match(summary.argsPreview, /context/);
  });

  it("summarizes Jira draft arguments without expanding large bodies", () => {
    const search = summarizeToolDraft(
      draft("jira_search_issues", {
        args: {
          jql: "project = NER ORDER BY updated DESC",
          max_results: 15,
          fields: ["summary", "status"],
        },
        done: true,
      }),
    );

    assert.equal(search.kind, "generic");
    assert.equal(search.path, "project = NER ORDER BY updated DESC");
    assert.deepEqual(
      search.meta.map((item) => item.text),
      ["max 15", "2 fields", "submitted"],
    );
    assert.ok(search.argsPreview);
    assert.ok(previewLines(search.argsPreview) <= DRAFT_PREVIEW_LINES);

    const transition = summarizeToolDraft(
      draft("jira_transition_issue", {
        args: { issue_key: "NER-1", transition: "Done", dry_run: true },
      }),
    );

    assert.equal(transition.path, "NER-1");
    assert.deepEqual(
      transition.meta.map((item) => item.text),
      ["Done", "dry run"],
    );
  });

  it("summarizes Confluence draft arguments", () => {
    const search = summarizeToolDraft(
      draft("confluence_search_pages", {
        args: { cql: "type = page", limit: 10, space_key: "DEV" },
        done: true,
      }),
    );

    assert.equal(search.kind, "generic");
    assert.equal(search.path, "type = page");
    assert.deepEqual(
      search.meta.map((item) => item.text),
      ["max 10", "space DEV", "submitted"],
    );

    const publish = summarizeToolDraft(
      draft("confluence_publish_pages", {
        args: {
          input_path: "/tmp/pages.jsonl",
          dry_run: true,
          create_missing: true,
        },
      }),
    );

    assert.equal(publish.path, "/tmp/pages.jsonl");
    assert.deepEqual(
      publish.meta.map((item) => item.text),
      ["dry run", "create missing"],
    );
  });

  it("provides capped argument previews for representative generic tools", () => {
    for (const [toolName, args] of [
      [
        "plan_mode_present",
        {
          file_path: "/home/u/.nerve/plans/plan.md",
          title: "Implementation plan",
          summary: "A concise plan for review",
        },
      ],
      ["read", { path: "src/app.ts", offset: 1, limit: 80 }],
      [
        "web_search",
        { query: "Svelte ResizeObserver visual line measurement" },
      ],
      [
        "task_start",
        {
          name: "dev",
          command: "pnpm --filter @nervekit/workbench-app dev",
          readyOnUrl: true,
        },
      ],
    ] as const) {
      const summary = summarizeToolDraft(draft(toolName, { args, done: true }));
      assert.equal(summary.kind, "generic", toolName);
      assert.ok(summary.argsPreview, toolName);
      assert.ok(
        previewLines(summary.argsPreview) <= DRAFT_PREVIEW_LINES,
        toolName,
      );
    }
  });
});
