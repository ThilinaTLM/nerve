import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import {
  CWD,
  exploreUpdate,
  metaText,
  present,
  presentTranscript,
  toolCall,
} from "./tool-result-view.fixtures";

describe("toolPresentation", () => {
  it("puts the file path in the clickable primary arg for read", () => {
    const p = present(
      "read",
      { path: "src/app.ts" },
      { path: `${CWD}/src/app.ts`, content: "a\nb\nc" },
    );
    assert.equal(p.badge, "read");
    assert.equal(p.primaryArg?.text, "src/app.ts");
    assert.equal(p.primaryArg?.openPath, `${CWD}/src/app.ts`);
    assert.deepEqual(metaText(p.meta), ["3 lines"]);
  });

  it("uses actual transcript counts instead of visible preview counts", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const entries = Array.from({ length: 10 }, (_, i) => ({
      path: `file-${i + 1}.ts`,
      kind: "file" as const,
    }));
    const task = {
      id: "task_01H00000000000000000000000",
      name: "dev",
      cwd: CWD,
      command: "pnpm dev",
      status: "running" as const,
      readiness: { outcome: "none" as const },
      stdoutPath: "/x/out",
      stderrPath: "/x/err",
      logsPath: "/x/log",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const read = presentTranscript(
      "read",
      { path: "AGENTS.md" },
      { path: `${CWD}/AGENTS.md`, content: tenLines },
      { previewOverflow: { hidden: 37, noun: "lines", direction: "head" } },
    );
    assert.deepEqual(metaText(read.meta), ["47 lines"]);
    assert.equal(read.detailsAction?.hidden, 37);

    const ls = presentTranscript(
      "ls",
      { path: "." },
      { path: CWD, entries },
      { previewOverflow: { hidden: 16, noun: "entries", direction: "head" } },
    );
    assert.deepEqual(metaText(ls.meta), ["26 entries"]);
    assert.equal(ls.detailsAction?.hidden, 16);

    const grep = presentTranscript(
      "grep",
      { pattern: "TODO" },
      {
        matches: entries.map((entry, index) => ({
          path: entry.path,
          line: index + 1,
          text: "TODO",
        })),
      },
      { previewOverflow: { hidden: 9, noun: "matches", direction: "head" } },
    );
    assert.ok(metaText(grep.meta).includes("19 matches"));

    const find = presentTranscript(
      "find",
      { pattern: "*.ts" },
      { path: CWD, entries },
      { previewOverflow: { hidden: 8, noun: "files", direction: "head" } },
    );
    assert.deepEqual(metaText(find.meta), ["18 files"]);

    const bash = presentTranscript(
      "bash",
      { command: "pnpm test" },
      { content: tenLines, exitCode: 0 },
      { previewOverflow: { hidden: 12, noun: "lines", direction: "tail" } },
    );
    assert.deepEqual(metaText(bash.meta), ["22 lines"]);

    const python = presentTranscript(
      "python",
      { code: "print('x')" },
      {
        content: tenLines,
        exitCode: 0,
        details: {
          outputLimits: {
            model: {
              truncated: false,
              displayedLines: 24,
              contentKind: "content_blocks",
            },
          },
        },
      },
      { previewOverflow: { hidden: 14, noun: "lines", direction: "tail" } },
    );
    assert.deepEqual(metaText(python.meta), ["24 lines"]);

    const write = presentTranscript(
      "write",
      { path: "out.txt", content: tenLines },
      { path: `${CWD}/out.txt`, content: "Wrote 100 bytes." },
      { previewOverflow: { hidden: 5, noun: "lines", direction: "tail" } },
    );
    assert.ok(metaText(write.meta).includes("15 lines"));

    const edit = presentTranscript(
      "edit",
      { path: "out.txt" },
      {
        path: `${CWD}/out.txt`,
        details: {
          diff: tenLines,
          lineEnding: "\n",
          bom: false,
          dryRun: false,
          operationCount: 1,
          operations: [{ index: 0, type: "replace_text", matchedBy: "unique" }],
        },
      },
      { previewOverflow: { hidden: 6, noun: "lines", direction: "tail" } },
    );
    assert.ok(metaText(edit.meta).includes("16 diff lines"));

    const taskLogs = presentTranscript(
      "task_logs",
      {},
      {
        task,
        events: Array.from({ length: 10 }, (_, index) => ({
          seq: index + 1,
          ts: "2026-01-01T00:00:00.000Z",
          stream: "stdout" as const,
          level: "info" as const,
          line: `line ${index + 1}`,
        })),
        nextCursor: 10,
        mode: "recent",
      },
      { previewOverflow: { hidden: 7, noun: "events", direction: "tail" } },
    );
    assert.ok(metaText(taskLogs.meta).includes("17 events"));
    assert.equal(taskLogs.detailsAction?.label, "Show 7 earlier events");

    const taskStatus = presentTranscript(
      "task_status",
      { status: "all" },
      { tasks: Array.from({ length: 5 }, () => task) },
      { previewOverflow: { hidden: 4, noun: "tasks", direction: "head" } },
    );
    assert.ok(metaText(taskStatus.meta).includes("9 tasks"));
    assert.equal(taskStatus.detailsAction?.label, "Show 4 more tasks");

    const taskCancel = presentTranscript(
      "task_cancel",
      { taskIds: ["task_one", "task_two"] },
      {
        outcomes: [
          {
            outcome: "already_terminal",
            status: "completed",
            message: "task one is already completed.",
          },
          {
            outcome: "no_matching_active_task",
            message: "No matching active task for task two.",
          },
        ],
      },
    );
    assert.ok(metaText(taskCancel.meta).includes("2 outcomes"));
  });

  it("marks a non-zero bash exit with an error chip and no collapse for short output", () => {
    const p = present(
      "bash",
      { command: "make build" },
      { content: "line1\nline2", exitCode: 2, details: { signal: null } },
    );
    assert.equal(p.primaryArg?.text, "make build");
    assert.equal(p.primaryArg?.openPath, undefined);
    assert.ok(p.meta.some((m) => m.text === "exit 2" && m.tone === "error"));
    assert.equal(p.detailsAction, undefined);
  });

  it("uses an inline marker for multi-line bash command primary args", () => {
    const command = "printf 'a' &&\n  printf 'b'";
    const p = present("bash", { command }, { content: "ok", exitCode: 0 });
    assert.equal(p.primaryArg?.text, "inline");
    assert.equal(p.primaryArg?.preserveWhitespace, undefined);
  });

  it("computes a tail collapse for long bash output", () => {
    const output = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    const p = present(
      "bash",
      { command: "x" },
      { content: output, exitCode: 0 },
    );
    assert.ok(p.detailsAction);
    assert.equal(p.detailsAction?.hidden, 15);
    assert.match(p.detailsAction?.label ?? "", /earlier lines/);
  });

  it("marks python execution outcomes without repeating input metadata", () => {
    const p = present(
      "python",
      { code: "print('x')\nprint('y')" },
      {
        content: "x\ny",
        exitCode: 3,
        details: { allowFileWrite: false, signal: null },
      },
    );
    assert.equal(p.primaryArg?.text, "inline");
    assert.ok(p.meta.some((m) => m.text === "exit 3" && m.tone === "error"));
    assert.equal(
      p.meta.some((m) => m.text.includes("code line")),
      false,
    );
    assert.ok(p.meta.some((m) => m.text === "2 lines"));
    assert.equal(
      p.meta.some((m) => m.text === "writes off"),
      false,
    );
    assert.equal(p.dotTone, "danger");
  });

  it("uses one-line inline Python code as the primary arg", () => {
    const p = present(
      "python",
      { code: "print('x')" },
      { content: "x", exitCode: 0 },
    );
    assert.equal(p.primaryArg?.text, "print('x')");
  });

  it("uses the script path as python primary arg for file mode", () => {
    const p = present(
      "python",
      { path: "scripts/report.py" },
      {
        content: "ok",
        exitCode: 0,
        details: { inputMode: "file", scriptPath: `${CWD}/scripts/report.py` },
      },
    );
    assert.equal(p.primaryArg?.text, "scripts/report.py");
    assert.equal(p.primaryArg?.openPath, `${CWD}/scripts/report.py`);
    assert.ok(!p.meta.some((m) => m.text.includes("code line")));
  });

  it("produces a collapse toggle when the python script alone exceeds the limit", () => {
    const code = Array.from({ length: 14 }, (_, i) => `line${i}`).join("\n");
    const p = present("python", { code }, { content: "ok" });
    assert.ok(p.detailsAction);
    assert.equal(p.detailsAction?.hidden, 4);
    assert.match(p.detailsAction?.label ?? "", /4 more lines/);
  });

  it("emits byte, line, and char chips for writes", () => {
    const p = present(
      "write",
      { path: "out.txt", content: "hello\nworld" },
      { path: `${CWD}/out.txt`, content: "Wrote 11 bytes." },
    );

    assert.deepEqual(metaText(p.meta), [
      "wrote 11 bytes",
      "2 lines",
      "11 chars",
    ]);
  });

  it("emits +/- chips for edit diffs", () => {
    const p = present(
      "edit",
      { path: "x.ts", replacements: [{ oldText: "a", newText: "b" }] },
      {
        path: `${CWD}/x.ts`,
        details: {
          diff: "@@ -1 +1 @@\n-a\n+b",
          lineEnding: "\n",
          bom: false,
          dryRun: false,
          operationCount: 1,
          operations: [{ index: 0, type: "replace_text", matchedBy: "unique" }],
        },
      },
    );
    assert.ok(p.meta.some((m) => m.text === "1 operation"));
    assert.ok(p.meta.some((m) => m.text === "+1" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "−1" && m.tone === "error"));
  });

  it("emits operation and preview chips for edit dry runs", () => {
    const p = present(
      "edit",
      {
        path: "x.ts",
        replacements: [{ oldText: "a", newText: "b" }],
      },
      {
        path: `${CWD}/x.ts`,
        details: {
          diff: "@@ -1 +1 @@\n-a\n+b",
          lineEnding: "\n",
          bom: false,
          dryRun: true,
          operationCount: 1,
          operations: [{ index: 0, type: "replace_text", matchedBy: "unique" }],
        },
      },
    );
    assert.ok(p.meta.some((m) => m.text === "1 operation"));
    assert.ok(p.meta.some((m) => m.text === "preview" && m.tone === "info"));
    assert.ok(p.meta.some((m) => m.text === "+1" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "−1" && m.tone === "error"));
  });

  it("marks errored edit calls with danger status", () => {
    const p = present(
      "edit",
      {
        path: "x.ts",
        replacements: [{ oldText: "a", newText: "b", note: "bad" }],
      },
      undefined,
      { status: "error", error: "Validation failed." },
    );
    assert.equal(p.dotTone, "danger");
    assert.equal(p.primaryArg?.text, "x.ts");
  });

  it("uses the url as an href primary arg for web_fetch", () => {
    const p = present(
      "web_fetch",
      { url: "https://example.test" },
      {
        content: "# Example",
        details: {
          url: "https://example.test",
          status: 200,
          contentType: "text/html",
          size: 9,
          converted: true,
        },
      },
    );
    assert.equal(p.primaryArg?.href, "https://example.test");
    assert.ok(p.meta.some((m) => m.text === "200" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "markdown" && m.tone === "info"));
  });

  it("shows the explore agent count instead of the input prompt", () => {
    const p = present(
      "explore",
      {
        tasks: [{ task: "Investigate the web UI" }],
        context: "Parent lookup identified the web UI flow for investigation.",
      },
      {
        reports: [
          {
            agentId: "agent_02H00000000000000000000000",
            task: "Trace UI flow",
            status: "completed",
            report: "Done",
          },
        ],
      },
    );
    assert.equal(p.badge, "explore");
    assert.equal(p.primaryArg?.text, "1/1 agent");
    assert.notEqual(p.primaryArg?.text, "Investigate the web UI");
  });

  it("shows live explore progress count beside the tool name", () => {
    const tc = toolCall(
      "explore",
      {
        tasks: [{ task: "Investigate the web UI" }],
        context: "Parent lookup identified the web UI flow for investigation.",
      },
      { reports: [] },
      { status: "running" },
    );
    const view = parseToolView(tc, {
      toolCallId: "tool_live_output",
      chunks: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      text: exploreUpdate("queued", "Starting 2 explore agents.", {
        taskCount: 2,
      }),
    });
    const p = toolPresentation(view, tc);
    assert.equal(p.badge, "explore");
    assert.equal(p.primaryArg?.text, "0/2 agents");
  });

  it("keeps explore footer chips focused on high-signal status", () => {
    const p = present(
      "explore",
      {},
      {
        reports: [
          {
            agentId: "agent_02H00000000000000000000000",
            task: "Trace API flow",
            status: "completed",
            report: "Done",
            reportPath: "/home/user/.nerve/explore-reports/api.md",
            model: "openai/gpt-5.5",
            usage: {
              input: 10,
              output: 20,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 30,
              cost: 0,
              turns: 2,
            },
          },
          {
            agentId: "agent_03H00000000000000000000000",
            task: "Trace UI flow",
            status: "failed",
            report: "Failed",
            errorMessage: "boom",
          },
        ],
      },
    );
    assert.equal(p.primaryArg?.text, "2/2 agents");
    assert.deepEqual(metaText(p.meta), ["1 failed"]);
    assert.equal(p.meta[0]?.tone, "error");
  });

  it("keeps the question in the header for an answered ask_user", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", response: "B" },
    );
    assert.equal(p.primaryArg?.text, "Which?");
    assert.deepEqual(metaText(p.meta), []);
  });

  it("keeps the question in the header for a dismissed ask_user", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", dismissed: true, dismissedReason: "aborted" },
    );
    assert.equal(p.primaryArg?.text, "Which?");
    assert.deepEqual(metaText(p.meta), []);
  });

  it("keeps the generic footer empty for a rejected plan_mode_present", () => {
    const p = present(
      "plan_mode_present",
      {
        file_path: "/home/user/.nerve/plans/feature.md",
        title: "Feature plan",
      },
      {
        review: {
          planPath: "/home/user/.nerve/plans/feature.md",
          status: "changes_requested",
        },
        outcome: "changes_requested",
      },
    );
    assert.equal(p.badge, "plan_mode_present");
    assert.equal(p.primaryArg?.text, "feature.md");
    assert.equal(p.primaryArg?.openPath, "/home/user/.nerve/plans/feature.md");
    assert.deepEqual(metaText(p.meta), []);
  });

  it("uses preview overflow for plan_mode_present details action", () => {
    const p = presentTranscript(
      "plan_mode_present",
      { file_path: "/home/user/.nerve/plans/feature.md" },
      {
        review: {
          planPath: "/home/user/.nerve/plans/feature.md",
          content: Array.from(
            { length: 10 },
            (_, index) => `line ${index + 1}`,
          ).join("\n"),
          status: "pending",
        },
        outcome: "pending",
      },
      {
        previewOverflow: { hidden: 7, noun: "lines", direction: "head" },
      },
    );
    assert.equal(p.badge, "plan_mode_present");
    assert.equal(p.detailsAction?.hidden, 7);
    assert.match(p.detailsAction?.label ?? "", /7 more lines/);
  });

  it("labels the badge as todos and reports progress", () => {
    const p = present(
      "todos_set",
      { todos: [] },
      {
        details: {
          todos: [
            { todo: "a", done: true },
            { todo: "b", done: false },
          ],
        },
      },
    );
    assert.equal(p.badge, "todos");
    assert.equal(p.primaryArg?.text, "1/2 done");
    assert.deepEqual(metaText(p.meta), []);
  });
});
