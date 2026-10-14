import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../../state/tool-types";
import { parseToolView } from "./tool-result-parser";

function call(
  toolName: string,
  args: unknown,
  result: unknown,
): ToolCallRecord {
  return {
    id: "call",
    agentId: "agent",
    conversationId: "conversation",
    projectId: "project",
    toolName,
    args,
    result,
    cwd: "/workspace",
    status: "completed",
    revision: 1,
    attempt: 1,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

describe("recorded planning tools", () => {
  for (const toolName of ["plan_mode_enter", "plan_mode_force_exit"]) {
    it(`renders ${toolName} through the redacted generic fallback`, () => {
      const view = parseToolView(
        call(
          toolName,
          { reason: "Historical planning request", api_token: "private-token" },
          { reason: "Historical outcome", api_token: "private-result" },
        ),
      );
      assert.equal(view.kind, "generic");
      if (view.kind !== "generic") return;
      assert.equal(view.toolName, toolName);
      const serialized = JSON.stringify(view);
      assert.match(serialized, /Historical planning request/);
      assert.match(serialized, /Historical outcome/);
      assert.match(serialized, /\[redacted\]/);
      assert.doesNotMatch(serialized, /private-token|private-result/);
    });
  }

  it("reads the complete reviewed snapshot from stored result details", () => {
    const view = parseToolView(
      call(
        "plan_mode_present",
        { file_path: "/workspace/plan.md" },
        {
          content: "Plan approved.",
          details: {
            decision: "approve",
            review: {
              id: "tool_plan",
              content: "# Reviewed plan",
              status: "accepted",
              planPath: "/snapshot/plan.md",
            },
          },
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.planPreview, "# Reviewed plan");
    assert.equal(view.outcome, "accepted");
    assert.equal(view.planPath, "/snapshot/plan.md");
  });

  it("keeps plan presentation and review data specialized", () => {
    const view = parseToolView(
      call(
        "plan_mode_present",
        { file_path: "/workspace/plan.md" },
        {
          review: { content: "Implementation plan", status: "accepted" },
          feedback: "Approved",
        },
      ),
    );
    assert.deepEqual(view, {
      kind: "plan_mode",
      action: "present",
      summary: "Approved",
      planPreview: "Implementation plan",
      planPath: "/workspace/plan.md",
      outcome: "accepted",
    });
  });
});
