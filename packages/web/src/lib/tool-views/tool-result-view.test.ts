import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../api";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";

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

  it("parses edit diff, replacement count, and +/- stats", () => {
    const view = parseToolView(
      toolCall(
        "edit",
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

  it("parses a process_start action with ready url", () => {
    const view = parseToolView(
      toolCall(
        "process_start",
        { command: "npm run dev" },
        {
          process: {
            id: "proc_01H00000000000000000000000",
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
    assert.equal(view.kind, "process_action");
    if (view.kind !== "process_action") return;
    assert.equal(view.action, "start");
    assert.equal(view.process?.status, "ready");
    assert.equal(view.process?.readiness.matched, "http://localhost:3000");
  });

  it("parses process_logs events", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      seq: index + 1,
      ts: "2026-01-01T00:00:00.000Z",
      stream: "stdout" as const,
      level: "info" as const,
      line: `line ${index + 1}`,
    }));
    const view = parseToolView(
      toolCall(
        "process_logs",
        { name: "dev" },
        {
          process: {
            id: "proc_01H00000000000000000000000",
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
    assert.equal(view.kind, "process_logs");
    if (view.kind !== "process_logs") return;
    assert.equal(view.events.length, 20);
    assert.equal(view.mode, "recent");
  });

  it("parses subagent summary and child id", () => {
    const view = parseToolView(
      toolCall(
        "subagent_run",
        { task: "Investigate the bug" },
        {
          agent: {
            id: "agent_02H00000000000000000000000",
            conversationId: "conv_01H00000000000000000000000",
            projectId: "proj_01H0000000000000000000000",
            projectDir: CWD,
            rootAgentId: "agent_01H00000000000000000000000",
            mode: "coding",
            permissionLevel: "read_only",
            workspaceScope: { roots: [CWD] },
            status: "idle",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          summary: "Found the off-by-one.",
        },
      ),
    );
    assert.equal(view.kind, "subagent_run");
    if (view.kind !== "subagent_run") return;
    assert.equal(view.summary, "Found the off-by-one.");
    assert.equal(view.childAgentId, "agent_02H00000000000000000000000");
  });

  it("parses plan_mode_enter", () => {
    const view = parseToolView(
      toolCall(
        "plan_mode_enter",
        {},
        {
          mode: "planning",
          planDir: "/home/tlm/.pi/plans",
          contentBlocks: [{ type: "text", text: "Plan mode active." }],
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "enter");
    assert.equal(view.planPath, "/home/tlm/.pi/plans");
    assert.equal(view.summary, "Plan mode active.");
  });

  it("parses plan_mode_present", () => {
    const view = parseToolView(
      toolCall(
        "plan_mode_present",
        { file_path: "/home/tlm/.pi/plans/feature.md" },
        {
          review: { planPath: "/home/tlm/.pi/plans/feature.md" },
          outcome: "accepted",
          feedback: "Looks good",
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "present");
    assert.equal(view.planPath, "/home/tlm/.pi/plans/feature.md");
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

  it("emits +/- chips for edit", () => {
    const p = present(
      "edit",
      { path: "x.ts", edits: [{ oldText: "a", newText: "b" }] },
      {
        path: `${CWD}/x.ts`,
        details: { diff: "@@ -1 +1 @@\n-a\n+b", lineEnding: "\n", bom: false },
      },
    );
    assert.ok(p.meta.some((m) => m.text === "+1" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "−1" && m.tone === "error"));
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

  it("shows a resolved chip for an answered ask_user with no primary arg", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", response: "B" },
    );
    assert.equal(p.primaryArg, undefined);
    assert.deepEqual(metaText(p.meta), ["answered"]);
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
