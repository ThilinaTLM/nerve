import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../api";
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
    sessionId: "ses_01H00000000000000000000000",
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
    assert.equal(view.title, "logo.png · image");
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

  it("parses bash exit code, tail, and saved-output path", () => {
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
    assert.deepEqual(view.tailLines, ["line1", "line2", "line3"]);
    assert.equal(view.savedTo, "/tmp/out.log");
    assert.equal(view.truncated, true);
  });

  it("parses edit diff and replacement count", () => {
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
    assert.equal(view.title, "src/x.ts · 2 replacements");
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

  it("parses process_logs tail", () => {
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
    assert.equal(view.tailEvents.length, 15);
    assert.equal(view.tailEvents[0]?.line, "line 6");
  });

  it("parses subagent summary and child id", () => {
    const view = parseToolView(
      toolCall(
        "subagent_run",
        { task: "Investigate the bug" },
        {
          agent: {
            id: "agent_02H00000000000000000000000",
            sessionId: "ses_01H00000000000000000000000",
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
