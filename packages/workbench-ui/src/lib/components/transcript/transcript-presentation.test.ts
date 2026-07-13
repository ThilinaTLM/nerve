import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { TimelineItem } from "../../state/timeline";
import type { ApprovalWithToolCall } from "../../state/tool-types";
import {
  activityStackPositions,
  isRoutineActivityNode,
  toolNodeNeedsAttention,
} from "./transcript-presentation";

describe("transcript presentation", () => {
  it("classifies contiguous activity stack positions", () => {
    assert.deepEqual(activityStackPositions([true, true, true]), [
      "start",
      "middle",
      "end",
    ]);
    assert.deepEqual(activityStackPositions([true]), ["single"]);
  });

  it("breaks stacks at prose, errors, and attention boundaries", () => {
    assert.deepEqual(
      activityStackPositions([true, true, false, true, false, true, true]),
      ["start", "end", undefined, "single", undefined, "start", "end"],
    );

    const attentionTool = {
      kind: "tool",
      key: "tool_1",
      toolCall: {
        id: "tool_1",
        status: "pending_approval",
      },
    } as TimelineItem;
    const approval = {
      id: "approval_1",
      toolCallId: "tool_1",
      status: "pending",
    } as ApprovalWithToolCall;
    assert.equal(
      toolNodeNeedsAttention(attentionTool, [approval], undefined, undefined),
      true,
    );
    assert.equal(isRoutineActivityNode(attentionTool, true), false);
  });
});
