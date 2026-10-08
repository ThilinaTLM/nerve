import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentActivitySnapshot, AgentRecord } from "$lib/api";
import {
  agentAttention,
  agentDetailFields,
  agentRole,
  agentRoleLabel,
  agentRowLabel,
  agentStatusBadge,
  agentStatusLabel,
  exploreFoldSummary,
  groupAgents,
  shortTaskLabel,
} from "./context-agent-rows";

function agent(id: string, patch: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    conversationId: "conv_1",
    projectId: "proj_1",
    projectDir: "/tmp/project",
    rootAgentId: "agent_root",
    mode: "coding",
    permissionLevel: "supervised",
    workspaceScope: { roots: ["/tmp/project"] },
    orchestrationPolicy: {
      preset: patch.parentAgentId ? "explore" : "standard",
      parentCancellation: "independent",
      completionReporting: "none",
    },
    budget: { depth: 0, maxDepth: 3 },
    thinkingLevel: "off",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as AgentRecord;
}

function activity(
  agentId: string,
  state: AgentActivitySnapshot["state"],
): AgentActivitySnapshot {
  return {
    agentId,
    conversationId: "conv_1",
    state,
    pendingInteractionCount: 0,
    pendingAsyncCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("context agent rows", () => {
  it("classifies lead, teammate, and explore roles", () => {
    assert.equal(agentRole(agent("lead")), "lead");
    assert.equal(
      agentRole(
        agent("mate", {
          parentAgentId: "lead",
          orchestrationPolicy: {
            preset: "developer",
            parentCancellation: "independent",
            completionReporting: "parent",
          },
        }),
      ),
      "teammate",
    );
    assert.equal(
      agentRole(agent("explore", { parentAgentId: "lead" })),
      "explore",
    );
  });

  it("uses policy rather than stale execution kind for child discovery", () => {
    assert.equal(
      agentRole(
        agent("child", {
          parentAgentId: "lead",
          executionKind: "async_developer",
          orchestrationPolicy: {
            preset: "explore",
            parentCancellation: "attached",
            completionReporting: "parent",
          },
        }),
      ),
      "explore",
    );
    assert.equal(
      agentRole(
        agent("child", {
          parentAgentId: "lead",
          executionKind: "explore",
          orchestrationPolicy: {
            preset: "developer",
            parentCancellation: "independent",
            completionReporting: "parent",
          },
        }),
      ),
      "teammate",
    );
  });

  it("groups and ranks agents using canonical activity", () => {
    const records = [
      agent("lead"),
      agent("mate-idle", {
        parentAgentId: "lead",
        orchestrationPolicy: {
          preset: "developer",
          parentCancellation: "independent",
          completionReporting: "parent",
        },
      }),
      agent("mate-running", {
        parentAgentId: "lead",
        orchestrationPolicy: {
          preset: "developer",
          parentCancellation: "independent",
          completionReporting: "parent",
        },
      }),
      agent("explore-running", { parentAgentId: "lead" }),
      agent("explore-done", { parentAgentId: "lead" }),
    ];
    const activityById = {
      "mate-running": activity("mate-running", "running"),
      "explore-running": activity("explore-running", "awaiting_user"),
    };
    const groups = groupAgents(records, "lead", activityById);
    assert.deepEqual(
      groups.teammates.map(({ id }) => id),
      ["mate-running", "mate-idle"],
    );
    assert.deepEqual(
      groups.exploreLive.map(({ id }) => id),
      ["explore-running"],
    );
    assert.deepEqual(
      groups.exploreDone.map(({ id }) => id),
      ["explore-done"],
    );
    assert.deepEqual(agentAttention(records, activityById), {
      needsYou: 1,
      working: 1,
    });
  });

  const discoveryStates: {
    state: AgentActivitySnapshot["state"];
    live: boolean;
    needsYou: number;
    working: number;
    finished: number;
    failed: number;
  }[] = [
    {
      state: "running",
      live: true,
      needsYou: 0,
      working: 1,
      finished: 0,
      failed: 0,
    },
    {
      state: "awaiting_user",
      live: true,
      needsYou: 1,
      working: 0,
      finished: 0,
      failed: 0,
    },
    {
      state: "awaiting_async",
      live: true,
      needsYou: 0,
      working: 1,
      finished: 0,
      failed: 0,
    },
    {
      state: "idle",
      live: false,
      needsYou: 0,
      working: 0,
      finished: 1,
      failed: 0,
    },
    {
      state: "error",
      live: false,
      needsYou: 0,
      working: 0,
      finished: 0,
      failed: 1,
    },
    {
      state: "aborted",
      live: false,
      needsYou: 0,
      working: 0,
      finished: 0,
      failed: 1,
    },
  ];

  for (const expected of discoveryStates) {
    it(`keeps ${expected.state} Explore discovery, fold, and attention consistent`, () => {
      const child = agent("explore", { parentAgentId: "lead" });
      const activityById = { explore: activity(child.id, expected.state) };
      const groups = groupAgents([child], child.id, activityById);
      assert.deepEqual(
        groups.exploreLive.map(({ id }) => id),
        expected.live ? [child.id] : [],
      );
      assert.deepEqual(
        groups.exploreDone.map(({ id }) => id),
        expected.live ? [] : [child.id],
      );
      assert.deepEqual(agentAttention([child], activityById), {
        needsYou: expected.needsYou,
        working: expected.working,
      });
      assert.deepEqual(exploreFoldSummary(groups.exploreDone, activityById), {
        finished: expected.finished,
        failed: expected.failed,
        label: expected.finished
          ? "1 finished"
          : expected.failed
            ? "1 failed"
            : "",
      });
    });
  }

  it("ranks live Explore attention and unfolds an idle child when background work starts", () => {
    const records = discoveryStates.map(({ state }) =>
      agent(state, { parentAgentId: "lead" }),
    );
    const activityById = Object.fromEntries(
      discoveryStates.map(({ state }) => [state, activity(state, state)]),
    );
    const groups = groupAgents(records, undefined, activityById);
    assert.deepEqual(
      groups.exploreLive.map(({ id }) => id),
      ["awaiting_user", "running", "awaiting_async"],
    );
    assert.deepEqual(exploreFoldSummary(groups.exploreDone, activityById), {
      finished: 1,
      failed: 2,
      label: "1 finished · 2 failed",
    });
    assert.deepEqual(agentAttention(records, activityById), {
      needsYou: 1,
      working: 2,
    });

    activityById.idle = activity("idle", "awaiting_async");
    const resumed = groupAgents(records, "idle", activityById);
    assert.ok(resumed.exploreLive.some(({ id }) => id === "idle"));
    assert.ok(!resumed.exploreDone.some(({ id }) => id === "idle"));
    assert.deepEqual(exploreFoldSummary(resumed.exploreDone, activityById), {
      finished: 0,
      failed: 2,
      label: "2 failed",
    });
    assert.deepEqual(agentAttention(records, activityById), {
      needsYou: 1,
      working: 3,
    });
    assert.deepEqual(
      agentStatusBadge(
        records.find(({ id }) => id === "idle")!,
        activityById.idle,
      ),
      {
        variant: "warning",
        text: "background work",
      },
    );
  });

  it("counts background work across lead, teammate, and Explore roles", () => {
    const records = [
      agent("lead"),
      agent("mate", {
        parentAgentId: "lead",
        orchestrationPolicy: {
          preset: "developer",
          parentCancellation: "independent",
          completionReporting: "parent",
        },
      }),
      agent("explore", { parentAgentId: "lead" }),
    ];
    const activityById = Object.fromEntries(
      records.map(({ id }) => [id, activity(id, "awaiting_async")]),
    );
    assert.deepEqual(agentAttention(records, activityById), {
      needsYou: 0,
      working: 3,
    });
  });

  it("summarizes failures from activity rather than agent records", () => {
    const done = [agent("ok"), agent("failed")];
    assert.deepEqual(
      exploreFoldSummary(done, { failed: activity("failed", "error") }),
      { finished: 1, failed: 1, label: "1 finished · 1 failed" },
    );
  });

  it("maps activity to role-aware badges including background work", () => {
    const lead = agent("lead");
    assert.deepEqual(agentStatusBadge(lead, activity("lead", "running")), {
      variant: "info",
      text: "working",
    });
    assert.deepEqual(
      agentStatusBadge(lead, activity("lead", "awaiting_async")),
      { variant: "warning", text: "background work" },
    );
    assert.equal(
      agentStatusLabel(activity("lead", "awaiting_user")),
      "awaiting user",
    );
  });

  it("derives concise labels for older explore records", () => {
    assert.equal(
      shortTaskLabel("Research async child creation, active model, and replay"),
      "Async child creation",
    );
    assert.equal(agentRowLabel(agent("lead")), "Lead agent");
    assert.equal(
      agentRowLabel(
        agent("child", {
          parentAgentId: "lead",
          task: "Investigate tool result projection",
        }),
      ),
      "Tool result projection",
    );
    assert.equal(
      agentRowLabel(
        agent("named", {
          parentAgentId: "lead",
          name: "Settings schema defaults",
          task: "Research settings schemas",
        }),
      ),
      "Settings schema defaults",
    );
    assert.equal(
      agentRowLabel(agent("blank", { parentAgentId: "lead", task: "   \n " })),
      "Explore agent",
    );
  });

  it("keeps role labels and detailed configuration", () => {
    const teammate = agent("child", {
      parentAgentId: "lead",
      orchestrationPolicy: {
        preset: "developer",
        parentCancellation: "independent",
        completionReporting: "parent",
      },
      name: "server-tests",
      mode: "planning",
      permissionRuleSetId: "autonomous",
      thinkingLevel: "low",
      budget: { depth: 1, maxDepth: 3 },
      model: { provider: "openai", modelId: "gpt-5.6-luna" },
    });
    assert.equal(agentRoleLabel(teammate), "Teammate");
    const fields = agentDetailFields(teammate);
    const value = (label: string) =>
      fields.find((field) => field.label === label)?.value;
    assert.equal(value("Depth"), "1 / 3");
    assert.equal(value("Mode"), "Planning");
    assert.equal(value("Rule set"), "Planning");
    assert.equal(value("Thinking"), "low");
    assert.equal(value("Model"), "openai/gpt-5.6-luna");
    assert.ok(!fields.some((field) => field.label === "Status"));
  });
});
