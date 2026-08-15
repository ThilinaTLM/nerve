import type { ToolCallRecord } from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInteractionActions,
  type InteractionActionDeps,
} from "./interaction-actions";

const toolCall = {
  id: "tool_1",
  revision: 2,
  status: "running",
  interactions: [],
} as unknown as ToolCallRecord;

function fixture(resolve?: InteractionActionDeps["requests"]["resolve"]) {
  const calls: Array<{ id: string; action: string }> = [];
  const notifications: Array<{ kind: string; title: string }> = [];
  const reconciled: string[] = [];
  const deps: InteractionActionDeps = {
    requests: {
      resolve:
        resolve ??
        (async (id, resolution) => {
          calls.push({ id, action: resolution.action });
          return { toolCall };
        }),
    },
    reconcile: {
      upsertToolCall: (value) => reconciled.push(value.id),
      upsertConversation: () => undefined,
      upsertAgent: () => undefined,
    },
    notify: {
      success: (title) => notifications.push({ kind: "success", title }),
      message: (title) => notifications.push({ kind: "message", title }),
      error: (title) => notifications.push({ kind: "error", title }),
    },
    openConversation: async () => undefined,
  };
  return {
    actions: createInteractionActions(deps),
    calls,
    notifications,
    reconciled,
  };
}

describe("canonical tool interaction actions", () => {
  it("keeps pending state and rethrows when resolution fails", async () => {
    const { actions, reconciled, notifications } = fixture(async () => {
      throw new Error("offline");
    });
    await assert.rejects(actions.denyApproval("approval_tool_1_0"), /offline/);
    assert.deepEqual(reconciled, []);
    assert.deepEqual(notifications, [
      { kind: "error", title: "Could not deny approval" },
    ]);
  });

  it("answers user input through the generic resolver", async () => {
    const { actions, calls, reconciled, notifications } = fixture();
    await actions.answerUserQuestionById("question_tool_1_0", "  yes  ");
    assert.deepEqual(calls, [{ id: "question_tool_1_0", action: "answer" }]);
    assert.deepEqual(reconciled, ["tool_1"]);
    assert.deepEqual(notifications, [{ kind: "success", title: "Reply sent" }]);
  });
});
