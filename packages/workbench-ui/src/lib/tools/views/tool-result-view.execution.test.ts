import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { CWD, toolCall } from "./tool-result-view.fixtures";

describe("parseToolView bash/python execution", () => {
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

  it("parses a backgrounded bash task disposition", () => {
    const view = parseToolView(
      toolCall(
        "bash",
        { command: "pnpm check" },
        {
          content: "Command was backgrounded.",
          details: {
            execution: {
              disposition: "backgrounded",
              taskId: "task_01H00000000000000000000000",
              status: "running",
              elapsedMs: 60_001,
              terminalUpdate: "automatic",
            },
          },
        },
      ),
    );
    assert.equal(view.kind, "bash");
    if (view.kind !== "bash") return;
    assert.deepEqual(view.backgroundTask, {
      taskId: "task_01H00000000000000000000000",
      status: "running",
      elapsedMs: 60_001,
      terminalUpdate: "automatic",
    });
  });

  it("normalizes agent-tool-result content arrays for bash previews", () => {
    const view = parseToolView(
      toolCall(
        "bash",
        { command: "git --help" },
        {
          content: [{ type: "text", text: "usage: git\n" }],
          details: { exitCode: 0, signal: null },
        },
      ),
    );
    assert.equal(view.kind, "bash");
    if (view.kind !== "bash") return;
    assert.equal(view.command, "git --help");
    assert.equal(view.output, "usage: git\n");
    assert.equal(view.exitCode, 0);
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
});
