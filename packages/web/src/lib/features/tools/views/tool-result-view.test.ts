import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exploreResultSchema } from "@nerve/shared";
import type { ToolCallRecord } from "$lib/api";
import { toolPresentation } from "./tool-presentation";
import { aggregateExploreTasks, parseToolView } from "./tool-result-view";

function exploreUpdate(
  phase: string,
  message: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "explore_progress",
    timestamp: "2026-01-01T00:00:00.000Z",
    phase,
    message,
    ...extra,
  });
}

const CWD = "/tmp/project";

function toolCall(
  toolName: ToolCallRecord["toolName"],
  args: unknown,
  result: unknown,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    risk: "read",
    args,
    cwd: CWD,
    status: "completed",
    result,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function present(
  toolName: ToolCallRecord["toolName"],
  args: unknown,
  result: unknown,
  overrides: Partial<ToolCallRecord> = {},
) {
  const tc = toolCall(toolName, args, result, overrides);
  return toolPresentation(parseToolView(tc), tc);
}

function metaText(meta: { text: string }[]): string[] {
  return meta.map((item) => item.text);
}

describe("parseToolView", () => {
  it("resolves relative read paths against Windows cwd", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "src/App.svelte" },
        { path: "src/App.svelte", content: "hello" },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.path, "C:\\Users\\me\\repo\\src\\App.svelte");
    assert.equal(view.relPath, "src/App.svelte");
  });

  it("does not prefix absolute Windows read paths", () => {
    const absolutePath = "C:\\Users\\me\\repo\\src\\App.svelte";
    const view = parseToolView(
      toolCall(
        "read",
        { path: absolutePath },
        { path: absolutePath, content: "hello" },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.path, absolutePath);
    assert.equal(view.relPath, "src/App.svelte");
  });

  it("parses a text read with relative path and line count", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "src/app.ts" },
        { path: `${CWD}/src/app.ts`, content: "a\nb\nc" },
      ),
    );
    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.relPath, "src/app.ts");
    assert.equal(view.lineLabel, "3 lines");
    assert.equal(view.image, undefined);
    assert.equal(view.content, "a\nb\nc");
  });

  it("parses an image read into a data URL", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "logo.png" },
        {
          path: `${CWD}/logo.png`,
          content: "Read image file [image/png]",
          contentBlocks: [
            { type: "text", text: "Read image file [image/png]" },
            { type: "image", data: "QUJD", mimeType: "image/png" },
          ],
        },
      ),
    );
    assert.equal(view.kind, "read");
    if (view.kind !== "read") return;
    assert.equal(view.image?.dataUrl, "data:image/png;base64,QUJD");
  });

  it("uses offset for the line label when reading a range", () => {
    const view = parseToolView(
      toolCall(
        "read",
        { path: "a.ts", offset: 10, limit: 3 },
        { path: `${CWD}/a.ts`, content: "x\ny\nz" },
      ),
    );
    assert.equal(view.kind === "read" && view.lineLabel, "lines 10–12");
  });

  it("parses bash exit code, combined output, and saved-output path", () => {
    const view = parseToolView(
      toolCall(
        "bash",
        { command: "make build" },
        {
          content: "line1\nline2\nline3",
          stdout: "line1\nline2\nline3",
          stderr: "",
          exitCode: 2,
          details: {
            signal: null,
            fullOutputPath: "/tmp/out.log",
            truncation: { truncated: true },
          },
        },
      ),
    );
    assert.equal(view.kind, "bash");
    if (view.kind !== "bash") return;
    assert.equal(view.command, "make build");
    assert.equal(view.exitCode, 2);
    assert.equal(view.output, "line1\nline2\nline3");
    assert.equal(view.savedTo, "/tmp/out.log");
    assert.equal(view.truncated, true);
  });

  it("parses python exit code, output, policy details, and saved-output path", () => {
    const view = parseToolView(
      toolCall(
        "python",
        { code: "print('hello')\nprint('done')" },
        {
          content: "hello\ndone",
          stdout: "hello\ndone",
          stderr: "",
          exitCode: 1,
          details: {
            signal: null,
            fullOutputPath: "/tmp/python.log",
            allowNetwork: true,
            allowFileWrite: false,
            durationMs: 42,
            timedOut: true,
            timeoutKilled: true,
            envKeys: ["NERVE_TEST_FLAG"],
            artifactDir: "/tmp/python-artifacts/run-abc",
            artifacts: [
              { path: "/tmp/python-artifacts/run-abc/report.json", size: 17 },
            ],
            streams: {
              stdout: {
                bytes: 1024,
                displayedBytes: 512,
                lines: 100,
                displayedLines: 50,
                truncated: true,
                omittedLines: 50,
                omittedBytes: 512,
                direction: "tail",
                savedTo: "/tmp/python-stdout.log",
              },
            },
            truncation: { truncated: true },
          },
        },
      ),
    );
    assert.equal(view.kind, "python");
    if (view.kind !== "python") return;
    assert.equal(view.inputMode, "inline");
    assert.equal(view.code, "print('hello')\nprint('done')");
    assert.equal(view.codeLineCount, 2);
    assert.equal(view.exitCode, 1);
    assert.equal(view.output, "hello\ndone");
    assert.equal(view.savedTo, "/tmp/python.log");
    assert.equal(view.allowFileWrite, false);
    assert.equal(view.durationMs, 42);
    assert.equal(view.timedOut, true);
    assert.equal(view.timeoutKilled, true);
    assert.deepEqual(view.envKeys, ["NERVE_TEST_FLAG"]);
    assert.equal(view.artifactDir, "/tmp/python-artifacts/run-abc");
    assert.equal(
      view.artifacts?.[0]?.path,
      "/tmp/python-artifacts/run-abc/report.json",
    );
    assert.equal(view.streams?.stdout?.truncated, true);
    assert.equal(view.streams?.stdout?.savedTo, "/tmp/python-stdout.log");
    assert.equal(view.truncated, true);
  });

  it("parses python script path arguments and file-mode result details", () => {
    const view = parseToolView(
      toolCall(
        "python",
        { path: "scripts/report.py" },
        {
          content: "ok",
          stdout: "ok",
          exitCode: 0,
          details: {
            inputMode: "file",
            scriptPath: `${CWD}/scripts/report.py`,
          },
        },
      ),
    );
    assert.equal(view.kind, "python");
    if (view.kind !== "python") return;
    assert.equal(view.inputMode, "file");
    assert.equal(view.code, undefined);
    assert.equal(view.codeLineCount, 0);
    assert.equal(view.scriptPath, `${CWD}/scripts/report.py`);
    assert.equal(view.relScriptPath, "scripts/report.py");
    assert.equal(view.output, "ok");
  });

  it("parses serialized python arguments and text content blocks", () => {
    const view = parseToolView(
      toolCall("python", JSON.stringify({ code: "print('from block')" }), {
        contentBlocks: [
          { type: "text", text: "from block" },
          { type: "text", text: "second line" },
        ],
        exitCode: 0,
      }),
    );
    assert.equal(view.kind, "python");
    if (view.kind !== "python") return;
    assert.equal(view.code, "print('from block')");
    assert.equal(view.output, "from block\nsecond line");
  });

  it("falls back to python stdout and stderr when content is absent", () => {
    const view = parseToolView(
      toolCall(
        "python",
        { code: "import sys\nprint('out')\nprint('err', file=sys.stderr)" },
        { stdout: "out\n", stderr: "err\n", exitCode: 0 },
      ),
    );
    assert.equal(view.kind, "python");
    if (view.kind !== "python") return;
    assert.equal(view.output, "out\nerr\n");
  });

  it("parses legacy_edit diff, replacement count, and +/- stats", () => {
    const view = parseToolView(
      toolCall(
        "legacy_edit",
        {
          path: "src/x.ts",
          edits: [
            { oldText: "a", newText: "b" },
            { oldText: "c", newText: "d" },
          ],
        },
        {
          path: `${CWD}/src/x.ts`,
          details: {
            diff: "@@ -1 +1 @@\n-a\n+b",
            lineEnding: "\n",
            bom: false,
          },
        },
      ),
    );
    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.replacements, 2);
    assert.equal(view.diff, "@@ -1 +1 @@\n-a\n+b");
    assert.equal(view.additions, 1);
    assert.equal(view.deletions, 1);
  });

  it("parses edit diff, operation count, dry-run flag, and +/- stats", () => {
    const view = parseToolView(
      toolCall(
        "edit",
        {
          path: "src/x.ts",
          replacements: [{ oldText: "a", newText: "b" }],
          dryRun: true,
        },
        {
          path: `${CWD}/src/x.ts`,
          details: {
            diff: "@@ -1 +1 @@\n-a\n+b",
            lineEnding: "\n",
            bom: false,
            dryRun: true,
            operationCount: 1,
            operations: [
              { index: 0, type: "replace_text", matchedBy: "unique" },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "edit");
    if (view.kind !== "edit") return;
    assert.equal(view.replacements, 1);
    assert.equal(view.operationLabel, "operation");
    assert.equal(view.dryRun, true);
    assert.equal(view.additions, 1);
    assert.equal(view.deletions, 1);
  });

  it("parses write byte count", () => {
    const view = parseToolView(
      toolCall(
        "write",
        { path: "out.txt", content: "hello" },
        { path: `${CWD}/out.txt`, content: "Wrote 5 bytes." },
      ),
    );
    assert.equal(view.kind === "write" && view.bytes, 5);
  });

  it("groups grep matches by file and counts them", () => {
    const view = parseToolView(
      toolCall(
        "grep",
        { pattern: "TODO" },
        {
          matches: [
            { path: "a.ts", line: 1, text: "// TODO one" },
            { path: "a.ts", line: 9, text: "// TODO two" },
            { path: "b.ts", line: 3, text: "// TODO three" },
          ],
        },
      ),
    );
    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.matchCount, 3);
    assert.equal(view.fileCount, 2);
    assert.equal(view.allMatches[0]?.path, "a.ts");
    assert.equal(view.allMatches[0]?.matches.length, 2);
  });

  it("preserves duplicate grep rows for the UI to render safely", () => {
    const duplicate = { path: "a.ts", line: 7, text: "const value = TODO;" };
    const view = parseToolView(
      toolCall(
        "grep",
        { pattern: "TODO" },
        { matches: [duplicate, duplicate] },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.matchCount, 2);
    assert.equal(view.fileCount, 1);
    assert.equal(view.allMatches[0]?.matches.length, 2);
    assert.deepEqual(
      view.allMatches[0]?.matches.map(({ path, line, text }) => ({
        path,
        line,
        text,
      })),
      [duplicate, duplicate],
    );
  });

  it("resolves grep match links against a Windows search root", () => {
    const view = parseToolView(
      toolCall(
        "grep",
        { path: "src", pattern: "setActiveComposerText" },
        {
          path: "C:\\Users\\me\\repo\\src",
          matches: [
            { path: "App.svelte", line: 163, text: "void openFilePane();" },
          ],
        },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(
      view.allMatches[0]?.openPath,
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
    assert.equal(
      view.allMatches[0]?.matches[0]?.openPath,
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("resolves grep match links against the search root", () => {
    const view = parseToolView(
      toolCall(
        "grep",
        { path: "packages/web/src", pattern: "setActiveComposerText" },
        {
          path: `${CWD}/packages/web/src`,
          matches: [
            { path: "App.svelte", line: 163, text: "void openFilePane();" },
          ],
        },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.allMatches[0]?.path, "App.svelte");
    assert.equal(
      view.allMatches[0]?.openPath,
      `${CWD}/packages/web/src/App.svelte`,
    );
    assert.equal(
      view.allMatches[0]?.matches[0]?.openPath,
      `${CWD}/packages/web/src/App.svelte`,
    );
  });

  it("truncates long grep match lines", () => {
    const longLine = `prefix ${"x".repeat(1_000)} suffix`;
    const view = parseToolView(
      toolCall(
        "grep",
        { pattern: "prefix" },
        { matches: [{ path: "dist/app.css", line: 1, text: longLine }] },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    const text = view.allMatches[0]?.matches[0]?.text ?? "";
    assert.ok(text.length <= 260);
    assert.match(text, /chars omitted/);
  });

  it("parses find paths", () => {
    const view = parseToolView(
      toolCall(
        "find",
        { pattern: "*.ts" },
        {
          entries: [
            { path: "a.ts", kind: "file" },
            { path: "b.ts", kind: "file" },
          ],
        },
      ),
    );
    assert.equal(view.kind === "find" && view.count, 2);
  });

  it("resolves find result links against a Windows search root", () => {
    const view = parseToolView(
      toolCall(
        "find",
        { path: "src", pattern: "*.svelte" },
        {
          path: "C:\\Users\\me\\repo\\src",
          entries: [{ path: "App.svelte", kind: "file" }],
        },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "find");
    if (view.kind !== "find") return;
    assert.equal(view.openPaths[0], "C:\\Users\\me\\repo\\src\\App.svelte");
  });

  it("resolves find result links against the search root", () => {
    const view = parseToolView(
      toolCall(
        "find",
        { path: "packages/web/src", pattern: "*.svelte" },
        {
          path: `${CWD}/packages/web/src`,
          entries: [{ path: "App.svelte", kind: "file" }],
        },
      ),
    );

    assert.equal(view.kind, "find");
    if (view.kind !== "find") return;
    assert.equal(view.paths[0], "App.svelte");
    assert.equal(view.openPaths[0], `${CWD}/packages/web/src/App.svelte`);
  });

  it("parses ls entries", () => {
    const view = parseToolView(
      toolCall(
        "ls",
        { path: "." },
        {
          path: CWD,
          entries: [
            { path: "src/", kind: "directory" },
            { path: "readme.md", kind: "file" },
          ],
        },
      ),
    );
    assert.equal(view.kind, "ls");
    if (view.kind !== "ls") return;
    assert.equal(view.total, 2);
    assert.equal(view.relPath, ".");
  });

  it("parses an answered ask_user result", () => {
    const view = parseToolView(
      toolCall(
        "ask_user",
        { question: "Which?" },
        { question: "Which?", recommendation: "A", response: "Go with B" },
      ),
    );
    assert.equal(view.kind, "ask_user");
    if (view.kind !== "ask_user") return;
    assert.equal(view.answer, "Go with B");
    assert.equal(view.dismissed, false);
  });

  it("parses a dismissed ask_user result", () => {
    const view = parseToolView(
      toolCall(
        "ask_user",
        { question: "Which?" },
        { question: "Which?", dismissed: true, dismissedReason: "aborted" },
      ),
    );
    assert.equal(view.kind === "ask_user" && view.dismissed, true);
  });

  it("parses todos_set from structured result details", () => {
    const view = parseToolView(
      toolCall(
        "todos_set",
        { todos: [] },
        {
          details: {
            todos: [
              { todo: "Inspect", done: true },
              { todo: "Implement", done: false },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "todos");
    if (view.kind !== "todos") return;
    assert.equal(view.completed, 1);
    assert.equal(view.total, 2);
  });

  it("parses empty todos_get", () => {
    const view = parseToolView(
      toolCall("todos_get", {}, { details: { todos: [] } }),
    );
    assert.equal(view.kind, "todos");
    if (view.kind !== "todos") return;
    assert.equal(view.completed, 0);
    assert.equal(view.total, 0);
    assert.deepEqual(view.items, []);
  });

  it("falls back to todos_set args when result details are missing", () => {
    const view = parseToolView(
      toolCall("todos_set", { todos: [{ todo: "Fallback", done: false }] }, {}),
    );
    assert.equal(view.kind, "todos");
    if (view.kind !== "todos") return;
    assert.deepEqual(view.items, [{ todo: "Fallback", done: false }]);
  });

  it("parses a task_start action with ready url", () => {
    const view = parseToolView(
      toolCall(
        "task_start",
        { command: "npm run dev" },
        {
          task: {
            id: "task_01H00000000000000000000000",
            name: "dev",
            cwd: CWD,
            command: "npm run dev",
            status: "ready",
            readiness: {
              readyOnUrl: true,
              outcome: "ready",
              matched: "http://localhost:3000",
            },
            stdoutPath: "/x/out",
            stderrPath: "/x/err",
            logsPath: "/x/log",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ),
    );
    assert.equal(view.kind, "task_action");
    if (view.kind !== "task_action") return;
    assert.equal(view.action, "start");
    assert.equal(view.task?.status, "ready");
    assert.equal(view.task?.readiness.matched, "http://localhost:3000");
  });

  it("parses task_logs events", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      seq: index + 1,
      ts: "2026-01-01T00:00:00.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: `line ${index + 1}`,
    }));
    const view = parseToolView(
      toolCall(
        "task_logs",
        { name: "dev" },
        {
          task: {
            id: "task_01H00000000000000000000000",
            name: "dev",
            cwd: CWD,
            command: "npm run dev",
            status: "running",
            readiness: { outcome: "none" },
            stdoutPath: "/x/out",
            stderrPath: "/x/err",
            logsPath: "/x/log",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          events,
          nextCursor: 20,
          mode: "recent",
        },
      ),
    );
    assert.equal(view.kind, "task_logs");
    if (view.kind !== "task_logs") return;
    assert.equal(view.events.length, 20);
    assert.equal(view.mode, "recent");
  });

  it("parses explore reports", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        { task: "Investigate the bug" },
        {
          reports: [
            {
              agentId: "agent_02H00000000000000000000000",
              task: "Investigate the bug",
              status: "completed",
              report: "Found the off-by-one.",
              reportPath: "/home/me/.nerve/explore-reports/report.md",
              summaryPreview: "Found the off-by-one.",
              usage: {
                input: 10,
                output: 20,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 30,
                cost: 0.001,
                turns: 1,
              },
              model: "anthropic/claude-sonnet-4",
              stopReason: "stop",
              steps: [
                {
                  type: "tool_call",
                  toolName: "grep",
                  message: "grep auth",
                  timestamp: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ),
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    assert.equal(view.reports[0]?.report, "Found the off-by-one.");
    assert.equal(view.reports[0]?.agentId, "agent_02H00000000000000000000000");
    assert.equal(
      view.reports[0]?.reportPath,
      "/home/me/.nerve/explore-reports/report.md",
    );
    assert.equal(view.reports[0]?.summaryPreview, "Found the off-by-one.");
    assert.equal(view.reports[0]?.status, "completed");
    assert.equal(view.reports[0]?.usage?.input, 10);
    assert.equal(view.reports[0]?.model, "anthropic/claude-sonnet-4");
    assert.equal(view.reports[0]?.stopReason, "stop");
    assert.equal(view.reports[0]?.steps?.[0]?.toolName, "grep");
  });

  it("accepts enriched explore result payloads", () => {
    const parsed = exploreResultSchema.safeParse({
      reports: [
        {
          agentId: "agent_02H00000000000000000000000",
          task: "Map failure behavior.",
          status: "failed",
          report: "Explore failed.",
          reportPath: "/home/me/.nerve/explore-reports/failure.md",
          summaryPreview: "Explore failed.",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 1,
            cacheWrite: 0,
            totalTokens: 16,
            cost: 0.01,
            turns: 2,
          },
          model: "provider/model",
          stopReason: "error",
          errorMessage: "boom",
          steps: [
            {
              type: "assistant",
              message: "Assistant response started.",
              timestamp: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.reports[0]?.status, "failed");
    assert.equal(parsed.data.reports[0]?.errorMessage, "boom");
  });

  it("parses explore live progress JSONL with plain-text fallback", () => {
    const view = parseToolView(
      toolCall("explore", { task: "Investigate" }, { reports: [] }),
      {
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          JSON.stringify({
            type: "explore_progress",
            timestamp: "2026-01-01T00:00:00.000Z",
            phase: "tool_call",
            message: "grep completed",
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          "legacy line",
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    assert.equal(view.liveUpdates.length, 1);
    assert.equal(view.liveUpdates[0]?.message, "grep completed");
    assert.equal(view.liveUpdates[0]?.label, "api");
    assert.equal(view.liveLog, "legacy line");
  });

  it("aggregates explore tasks mid-flight with denoised actions", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        { task: "Investigate" },
        { reports: [] },
        {
          status: "running",
        },
      ),
      {
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: [
          exploreUpdate("queued", "Starting 2 explore agents.", {
            taskCount: 2,
          }),
          exploreUpdate("started", "Explore 1/2 started", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          exploreUpdate("tool_call", "read server.ts", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          exploreUpdate("assistant", "Assistant response started.", {
            taskIndex: 0,
            taskCount: 2,
            label: "api",
          }),
          exploreUpdate("started", "Explore 2/2 started", {
            taskIndex: 1,
            taskCount: 2,
            label: "web",
          }),
        ].join("\n"),
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks, summary } = aggregateExploreTasks(view);
    assert.equal(summary.total, 2);
    assert.equal(summary.completed, 0);
    assert.equal(summary.done, false);
    assert.equal(tasks.length, 2);
    // Task 0: prefers the concrete tool action over the "assistant" noise line.
    assert.equal(tasks[0]?.status, "running");
    assert.equal(tasks[0]?.currentAction, "read server.ts");
    assert.equal(tasks[0]?.currentActionMono, true);
    assert.equal(tasks[0]?.actionCount, 1);
    assert.equal(tasks[0]?.label, "api");
    // Task 1: started but no tool action yet.
    assert.equal(tasks[1]?.status, "running");
    assert.equal(tasks[1]?.currentAction, "Starting…");
  });

  it("aggregates explore tasks with mixed completed and failed results", () => {
    const view = parseToolView(
      toolCall(
        "explore",
        {},
        {
          reports: [
            {
              agentId: "agent_02H00000000000000000000000",
              task: "Task A",
              label: "alpha",
              status: "completed",
              report: "done",
              reportPath: "/home/me/.nerve/explore-reports/a.md",
              summaryPreview: "Summary A",
            },
            {
              agentId: "agent_03H00000000000000000000000",
              task: "Task B",
              label: "beta",
              status: "failed",
              report: "failed",
              reportPath: "/home/me/.nerve/explore-reports/b.md",
              summaryPreview: "Failure B",
              errorMessage: "boom",
            },
          ],
        },
      ),
      {
        chunks: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        text: "",
      },
    );
    assert.equal(view.kind, "explore");
    if (view.kind !== "explore") return;
    const { tasks, summary } = aggregateExploreTasks(view);
    assert.equal(summary.total, 2);
    assert.equal(summary.completed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.done, true);
    assert.equal(tasks[0]?.status, "completed");
    assert.equal(
      tasks[0]?.report?.reportPath,
      "/home/me/.nerve/explore-reports/a.md",
    );
    assert.equal(tasks[0]?.label, "alpha");
    assert.equal(tasks[1]?.status, "failed");
    assert.equal(tasks[1]?.error, "boom");
    assert.equal(
      tasks[1]?.report?.reportPath,
      "/home/me/.nerve/explore-reports/b.md",
    );
  });

  it("parses plan_mode_enter", () => {
    const view = parseToolView(
      toolCall(
        "plan_mode_enter",
        {},
        {
          mode: "planning",
          planDir: "/home/user/.nerve/plans",
          contentBlocks: [{ type: "text", text: "Plan mode active." }],
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "enter");
    assert.equal(view.planPath, "/home/user/.nerve/plans");
    assert.equal(view.summary, "Plan mode active.");
  });

  it("parses plan_mode_present", () => {
    const view = parseToolView(
      toolCall(
        "plan_mode_present",
        { file_path: "/home/user/.nerve/plans/feature.md" },
        {
          review: { planPath: "/home/user/.nerve/plans/feature.md" },
          outcome: "accepted",
          feedback: "Looks good",
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "present");
    assert.equal(view.planPath, "/home/user/.nerve/plans/feature.md");
    assert.equal(view.outcome, "accepted");
    assert.equal(view.summary, "Looks good");
  });

  it("parses plan_mode_force_exit", () => {
    const view = parseToolView(
      toolCall("plan_mode_force_exit", {}, { mode: "coding", reason: "Done" }),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "force_exit");
    assert.equal(view.summary, "Done");
  });

  it("parses web_search results", () => {
    const view = parseToolView(
      toolCall(
        "web_search",
        { query: "nerve agent" },
        {
          content:
            "**Answer:** It searches.\n\n### Result\nhttps://example.test",
          details: {
            query: "nerve agent",
            answer: "It searches.",
            results: [{ title: "Result", url: "https://example.test" }],
          },
        },
      ),
    );
    assert.equal(view.kind, "web_search");
    if (view.kind !== "web_search") return;
    assert.equal(view.answer, "It searches.");
    assert.equal(view.results.length, 1);
  });

  it("parses web_fetch details and content", () => {
    const view = parseToolView(
      toolCall(
        "web_fetch",
        { url: "https://example.test" },
        {
          content: "# Example\n\nFetched markdown.",
          details: {
            url: "https://example.test",
            status: 200,
            contentType: "text/html; charset=utf-8",
            size: 120,
            converted: true,
          },
        },
      ),
    );
    assert.equal(view.kind, "web_fetch");
    if (view.kind !== "web_fetch") return;
    assert.equal(view.status, 200);
    assert.equal(view.converted, true);
    assert.match(view.content ?? "", /Fetched markdown/);
  });

  it("falls back to generic for a malformed result", () => {
    const view = parseToolView(
      toolCall("grep", { pattern: "x" }, "not an object"),
    );
    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.matchCount, 0);
  });

  it("returns generic for unknown tools", () => {
    const view = parseToolView(
      toolCall("read", {}, undefined, {
        toolName: "mystery" as ToolCallRecord["toolName"],
      }),
    );
    assert.equal(view.kind, "generic");
  });
});

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

  it("marks a non-zero bash exit with an error chip and no collapse for short output", () => {
    const p = present(
      "bash",
      { command: "make build" },
      { content: "line1\nline2", exitCode: 2, details: { signal: null } },
    );
    assert.equal(p.primaryArg?.text, "make build");
    assert.equal(p.primaryArg?.openPath, undefined);
    assert.ok(p.meta.some((m) => m.text === "exit 2" && m.tone === "error"));
    assert.equal(p.collapse, undefined);
  });

  it("computes a tail collapse for long bash output", () => {
    const output = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    const p = present(
      "bash",
      { command: "x" },
      { content: output, exitCode: 0 },
    );
    assert.ok(p.collapse);
    assert.equal(p.collapse?.hidden, 15);
    assert.match(p.collapse?.expandLabel ?? "", /earlier lines/);
  });

  it("marks python exits and planning write guard metadata with an inline source marker", () => {
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
    assert.ok(p.meta.some((m) => m.text === "2 code lines"));
    assert.ok(p.meta.some((m) => m.text === "2 lines"));
    assert.ok(
      p.meta.some((m) => m.text === "writes off" && m.tone === "warning"),
    );
    assert.equal(p.dotTone, "danger");
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
    assert.ok(p.collapse);
    assert.equal(p.collapse?.hidden, 4);
    assert.match(p.collapse?.expandLabel ?? "", /Show 4 more lines/);
  });

  it("emits +/- chips for legacy_edit", () => {
    const p = present(
      "legacy_edit",
      { path: "x.ts", edits: [{ oldText: "a", newText: "b" }] },
      {
        path: `${CWD}/x.ts`,
        details: { diff: "@@ -1 +1 @@\n-a\n+b", lineEnding: "\n", bom: false },
      },
    );
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
      { path: "x.ts", edits: [{ oldText: "a", newText: "b", note: "bad" }] },
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

  it("shows no footer chip for an answered ask_user with no primary arg", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", response: "B" },
    );
    assert.equal(p.primaryArg, undefined);
    assert.deepEqual(metaText(p.meta), []);
  });

  it("shows no footer chip for a dismissed ask_user", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", dismissed: true, dismissedReason: "aborted" },
    );
    assert.equal(p.primaryArg, undefined);
    assert.deepEqual(metaText(p.meta), []);
  });

  it("shows no footer chip for a rejected plan_mode_present", () => {
    const p = present(
      "plan_mode_present",
      { file_path: "/home/user/.nerve/plans/feature.md" },
      {
        review: {
          planPath: "/home/user/.nerve/plans/feature.md",
          status: "changes_requested",
        },
        outcome: "changes_requested",
      },
    );
    assert.equal(p.badge, "plan_mode_present");
    assert.equal(p.primaryArg?.text, "/home/user/.nerve/plans/feature.md");
    assert.deepEqual(metaText(p.meta), []);
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
    assert.deepEqual(metaText(p.meta), ["1/2 done"]);
  });
});
