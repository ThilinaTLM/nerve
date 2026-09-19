import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { present, toolCall } from "./tool-result-view.fixtures";

describe("parseToolView bash/python execution", () => {
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

  it("presents a promoted bash call as unfinished work with a task handle", () => {
    const presentation = present(
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
    );
    // Completed for the agent, still owing a result for the reader.
    assert.equal(presentation.dotTone, "warning");
    assert.equal(presentation.dotPulse, false);
    assert.equal(presentation.glyph, "pending");
    assert.equal(
      presentation.backgroundTaskId,
      "task_01H00000000000000000000000",
    );
    // Promotion never strips the result body's own metadata.
    assert.ok(
      presentation.meta.some((item) =>
        item.text.startsWith("background task_"),
      ),
    );
  });

  it("leaves an ordinary bash call on the default tool glyph", () => {
    const presentation = present(
      "bash",
      { command: "echo hi" },
      { content: "hi\n", details: { exitCode: 0 } },
    );
    assert.equal(presentation.glyph, undefined);
    assert.equal(presentation.backgroundTaskId, undefined);
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

  it("parses historical python arguments and text content blocks", () => {
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
        "python_exec",
        { code: "import sys\nprint('out')\nprint('err', file=sys.stderr)" },
        { stdout: "out\n", stderr: "err\n", exitCode: 0 },
      ),
    );
    assert.equal(view.kind, "python");
    if (view.kind !== "python") return;
    assert.equal(view.output, "out\nerr\n");
  });
});
