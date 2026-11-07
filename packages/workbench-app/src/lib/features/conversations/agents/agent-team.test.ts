import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentActivitySnapshot } from "$lib/presentation/view-models/conversation";
import { agentRowState, hasStoppableWork, pendingWork } from "./agent-team";

function activity(
  state: AgentActivitySnapshot["state"],
): AgentActivitySnapshot {
  return {
    agentId: "a",
    conversationId: "a",
    state,
    pendingInteractionCount: 0,
    pendingAsyncCount: 0,
    updatedAt: "",
  };
}

describe("agent activity state", () => {
  it("distinguishes running, user/async waits, error and abortion", () => {
    const states: AgentActivitySnapshot["state"][] = [
      "running",
      "awaiting_user",
      "awaiting_async",
      "error",
      "aborted",
      "idle",
    ];
    assert.deepEqual(
      states.map((state) => agentRowState(activity(state))),
      ["working", "needs_you", "waiting", "failed", "stopped", "idle"],
    );
    assert.equal(agentRowState(undefined), "idle");
  });
});

describe("pending work", () => {
  it("lists unfinished sub-agents, including idle ones with background work, and running commands", () => {
    const items = pendingWork({
      children: [
        {
          id: "c1",
          title: "auth-research",
          status: "running",
          pendingWork: false,
          createdAt: "2026-10-01T00:00:00Z",
          lastParentPromptAt: "2026-10-02T00:00:00Z",
        },
        {
          id: "c2",
          title: "done",
          status: "idle",
          pendingWork: false,
          createdAt: "2026-10-01T00:00:00Z",
        },
        {
          id: "c3",
          title: "new-prompt",
          status: "waiting",
          pendingWork: false,
          createdAt: "2026-10-01T00:00:00Z",
          lastParentPromptAt: "2026-10-03T00:00:00Z",
        },
        {
          id: "c4",
          title: "capture",
          status: "idle",
          pendingWork: true,
          createdAt: "2026-10-01T00:00:00Z",
          lastParentPromptAt: "2026-10-01T12:00:00Z",
        },
      ],
      asyncBash: [
        { id: "b1", command: "pnpm test\nmore", status: "running" },
        { id: "b2", command: "ls", status: "completed" },
      ] as never,
    });
    assert.deepEqual(items, [
      { kind: "agent", id: "c3", label: "new-prompt" },
      { kind: "agent", id: "c1", label: "auth-research" },
      { kind: "agent", id: "c4", label: "capture" },
      { kind: "command", id: "b1", label: "pnpm test" },
    ]);
  });
});

describe("stoppable work", () => {
  const idle = { status: "idle" as const, pendingWork: false };
  const snapshot = (
    patch: Partial<Parameters<typeof hasStoppableWork>[0] & object> = {},
  ) => ({
    conversation: { status: "idle" as const },
    children: [idle],
    asyncBash: [{ status: "completed" }] as never,
    ...patch,
  });

  it("stays stoppable while idle with background work that can wake it", () => {
    assert.equal(hasStoppableWork(undefined), false);
    assert.equal(hasStoppableWork(snapshot()), false);
    assert.equal(
      hasStoppableWork(snapshot({ conversation: { status: "waiting" } })),
      true,
    );
    assert.equal(
      hasStoppableWork(
        snapshot({ asyncBash: [{ status: "running" }] as never }),
      ),
      true,
    );
    assert.equal(
      hasStoppableWork(
        snapshot({ children: [idle, { status: "idle", pendingWork: true }] }),
      ),
      true,
    );
  });
});
