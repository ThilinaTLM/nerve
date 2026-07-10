import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterConversationGroups } from "../components/navigator/conversation-group-model.js";
import {
  closeWorkbenchDrawers,
  toggleWorkbenchPane,
} from "../components/workbench/workbench-layout.js";
import {
  conversationBanner,
  conversationReviewBlocked,
  currentTodosForAgent,
} from "./conversation-view.js";

const now = "2026-07-10T00:00:00.000Z";

describe("shared conversation view selectors", () => {
  it("selects the latest completed todo list", () => {
    const todos = currentTodosForAgent(
      [
        {
          id: "tool_1",
          agentId: "agent_1",
          conversationId: "conv_1",
          projectId: "proj_1",
          toolName: "todos_set",
          risk: "interaction",
          cwd: "/tmp",
          status: "completed",
          argsPreview: { todos: [{ todo: "old", done: false }] },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "tool_2",
          agentId: "agent_1",
          conversationId: "conv_1",
          projectId: "proj_1",
          toolName: "todos_set",
          risk: "interaction",
          cwd: "/tmp",
          status: "completed",
          resultPreview: {
            details: { todos: [{ todo: "latest", done: true }] },
          },
          createdAt: now,
          updatedAt: "2026-07-10T00:00:01.000Z",
        },
      ],
      "agent_1",
    );
    assert.deepEqual(todos, [{ todo: "latest", done: true }]);
  });

  it("derives review blocking and snapshot banners", () => {
    assert.equal(conversationReviewBlocked({ approvals: [] }), false);
    assert.equal(
      conversationReviewBlocked({
        pendingUserQuestion: {} as never,
      }),
      true,
    );
    assert.deepEqual(
      conversationBanner({
        entries: [],
        activeEntryIds: [],
        toolCalls: [],
        cursorSeq: 0,
        readOnly: true,
        fallbackReason: "offline",
      }),
      { tone: "warning", title: "Read-only snapshot.", message: "offline" },
    );
  });

  it("filters grouped navigator models and transitions layouts", () => {
    const groups = filterConversationGroups(
      [{ id: "p", title: "Project", items: [{ id: "c", title: "Alpha" }] }],
      "alpha",
    );
    assert.equal(groups[0]?.items[0]?.id, "c");
    assert.deepEqual(
      closeWorkbenchDrawers({ compact: true, navDrawerOpen: true }),
      { compact: true, navDrawerOpen: false, utilityDrawerOpen: false },
    );
    assert.equal(
      toggleWorkbenchPane({ sidebarCollapsed: false }, "navigator")
        .sidebarCollapsed,
      true,
    );
  });
});
