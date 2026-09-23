import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentRecordSchema,
  type AgentRecord,
  type AsyncSubagentControl,
} from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import {
  AsyncSubagentService,
  type AsyncSubagentPorts,
} from "../../../src/domains/agents/async-subagent.service.js";
import { newRun } from "../../../src/domains/runs/runtime/run-transitions.js";

function setup() {
  const lead = agentRecordSchema.parse({
    id: "agent_lead",
    rootAgentId: "agent_lead",
    conversationId: "conv_team",
    projectId: "proj_team",
    projectDir: "/tmp/nerve-team-test",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/nerve-team-test"] },
    status: "idle",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const agents = new Map<string, AgentRecord>([[lead.id, lead]]);
  const controls = new Map<string, AsyncSubagentControl>();
  const runs = new Map<string, RunRecord>();
  const entries: ConversationEntry[] = [];
  let enabled = true;
  let cancelGate: Promise<void> | undefined;
  let starts = 0;
  const ports: AsyncSubagentPorts = {
    getAgent: (id) => {
      const agent = agents.get(id);
      if (!agent) throw new Error("missing agent");
      return agent;
    },
    listAgents: () => [...agents.values()],
    createAgent: async (request) => {
      const agent = agentRecordSchema.parse({
        ...lead,
        ...request,
        id: `agent_child_${agents.size}`,
      });
      agents.set(agent.id, agent);
      return agent;
    },
    enabled: async () => enabled,
    readControl: async (id) =>
      controls.get(id) ?? {
        agentId: id,
        generation: 0,
        stopped: false,
        stopping: false,
      },
    writeControl: async (record) => {
      controls.set(record.agentId, record);
    },
    activeRun: async (agent) => {
      const run = runs.get(agent.id);
      return run?.status === "running" ? run : undefined;
    },
    latestRun: async (agent) => runs.get(agent.id),
    reserveAssignment: async () => {},
    start: async (agent, runId) => {
      starts++;
      const run: RunRecord = {
        ...newRun(
          { ...agent, agentId: agent.id, runId },
          `${agent.conversationId}:${agent.id}`,
          new Date().toISOString(),
          { next: () => "test" },
        ),
        status: "running",
      };
      runs.set(agent.id, run);
      return run;
    },
    cancel: async (agent) => {
      await cancelGate;
      const run = runs.get(agent.id);
      if (run) runs.set(agent.id, { ...run, status: "cancelled" });
    },
    activeTaskCount: () => 0,
    entries: async () => entries,
  };
  const service = new AsyncSubagentService(ports);
  return {
    service,
    lead,
    agents,
    controls,
    runs,
    entries,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    gateCancel: (gate: Promise<void>) => {
      cancelGate = gate;
    },
    starts: () => starts,
  };
}

describe("persistent autonomous developer teammates", () => {
  it("creates an autonomous child in the lead's exact working directory without copying history", async () => {
    const f = setup();
    const result = await f.service.create(f.lead.id, "API", true);
    const child = [...f.agents.values()].find(
      (agent) => agent.name === result.name,
    )!;
    assert.equal(result.state, "idle");
    assert.equal(child.projectDir, f.lead.projectDir);
    assert.equal(child.permissionRuleSetId, "autonomous");
    assert.equal(child.executionKind, "async_developer");
    assert.equal(child.parentAgentId, f.lead.id);
    await assert.rejects(
      f.service.create(f.lead.id, " api ", true),
      /name already exists/,
    );
  });

  it("atomically admits only one prompt and hides response bodies while busy", async () => {
    const f = setup();
    await f.service.create(f.lead.id, "API", true);
    const results = await Promise.allSettled([
      f.service.prompt(f.lead.id, "API", "first"),
      f.service.prompt(f.lead.id, "API", "second"),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(f.starts(), 1);
    assert.equal(
      (await f.service.status(f.lead.id, "API")).response,
      undefined,
    );
    assert.equal((await f.service.status(f.lead.id, "API")).state, "running");
  });

  it("does not admit a replacement assignment until cancellation settles", async () => {
    const f = setup();
    await f.service.create(f.lead.id, "API", true);
    await f.service.prompt(f.lead.id, "API", "work");
    let release!: () => void;
    f.gateCancel(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const stopping = f.service.stop(f.lead.id, "API");
    // Wait for the serialized stop fence, not a timer or provider execution.
    while (
      !f.controls.get(
        [...f.agents.values()].find((agent) => agent.name === "API")!.id,
      )?.stopping
    )
      await Promise.resolve();
    await assert.rejects(
      f.service.prompt(f.lead.id, "API", "replacement"),
      /running or stopping/,
    );
    release();
    await stopping;
    await f.service.prompt(f.lead.id, "API", "replacement");
    assert.equal(f.starts(), 2);
  });

  it("fences automatic child wakeups after team stop and preserves explicit reuse", async () => {
    const f = setup();
    await f.service.create(f.lead.id, "API", true);
    await f.service.prompt(f.lead.id, "API", "work");
    await f.service.stopTeam(f.lead.id);
    await f.service.wake(
      [...f.agents.values()].find((agent) => agent.name === "API")!.id,
    );
    assert.equal(f.starts(), 1);
    await assert.rejects(
      f.service.prompt(f.lead.id, "API", "work"),
      /team is stopped/,
    );
    await f.service.reopen(f.lead.id);
    await f.service.prompt(f.lead.id, "API", "new work");
    assert.equal(f.starts(), 2);
  });

  it("allows the same teammate name under different leads but resolves controls only within each team", async () => {
    const f = setup();
    const other = { ...f.lead, id: "agent_other", rootAgentId: "agent_other" };
    f.agents.set(other.id, other);
    await f.service.create(f.lead.id, "Researcher", true);
    await f.service.create(other.id, " researcher ", true);
    await assert.rejects(
      f.service.create(f.lead.id, " researcher ", true),
      /name already exists/,
    );
    const first = await f.service.prompt(f.lead.id, " researcher ", "first");
    const second = await f.service.prompt(other.id, "RESEARCHER", "second");
    assert.notEqual(first.runId, second.runId);
    await f.service.stop(f.lead.id, "Researcher");
    assert.equal(
      (await f.service.status(other.id, "researcher")).state,
      "running",
    );
    await assert.rejects(
      f.service.status(f.lead.id, "missing"),
      /not found for this lead/,
    );
  });

  it("rejects disabled capability and cross-lead access", async () => {
    const f = setup();
    await f.service.create(f.lead.id, "API", true);
    const other = { ...f.lead, id: "agent_other", rootAgentId: "agent_other" };
    f.agents.set(other.id, other);
    await assert.rejects(
      f.service.status(other.id, "API"),
      /not found for this lead/,
    );
    f.setEnabled(false);
    await assert.rejects(
      f.service.prompt(f.lead.id, "API", "work"),
      /unavailable/,
    );
  });

  it("enforces the four-execution cap without limiting idle teammates", async () => {
    const f = setup();
    const children = [];
    for (let i = 0; i < 5; i++)
      children.push(await f.service.create(f.lead.id, `Component ${i}`, true));
    for (const child of children.slice(0, 4))
      await f.service.prompt(f.lead.id, child.name, "work");
    await assert.rejects(
      f.service.prompt(f.lead.id, children[4]!.name, "work"),
      /four developer teammates/,
    );
  });
});
