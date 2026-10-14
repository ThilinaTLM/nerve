import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../../state/tool-types";
import { toolPresentation } from "./tool-presentation";
import type { ToolView } from "./tool-view-types";

function call(status: ToolCallRecord["status"] = "completed"): ToolCallRecord {
  return {
    id: "call",
    agentId: "agent",
    conversationId: "conversation",
    projectId: "project",
    toolName: "bash",
    args: { command: "true" },
    cwd: "/workspace",
    status,
    revision: 1,
    attempt: 1,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

function bashView(exitCode?: number): ToolView {
  return {
    kind: "bash",
    command: "true",
    exitCode,
    output: "",
    outputLineCount: 0,
    truncated: false,
    live: false,
  };
}

describe("Bash exit metadata", () => {
  for (const exitCode of [0, 1, 127, -1]) {
    it(`shows actual exit ${exitCode} with its status tone`, () => {
      const presentation = toolPresentation(bashView(exitCode), call());
      assert.deepEqual(presentation.meta, [
        {
          text: `exit ${exitCode}`,
          tone: exitCode === 0 ? "success" : "destructive",
        },
      ]);
    });
  }

  for (const status of ["completed", "running"] as const) {
    it(`does not invent an exit code for ${status} calls`, () => {
      assert.deepEqual(toolPresentation(bashView(), call(status)).meta, []);
    });
  }
});
