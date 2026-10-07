import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentRecordSchema,
  agentConfigurationSchema,
  type ParentConfigurationSnapshot,
  type AsyncSubagentAssignment,
  type AsyncSubagentControl,
} from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import {
  AsyncSubagentService,
  type AsyncSubagentPorts,
} from "../../../src/domains/agents/async-subagent.service.js";
import {
  AgentInputService,
  type AgentInputQueueState,
} from "../../../src/domains/runs/runtime/agent-inputs.js";
import { newRun } from "../../../src/domains/runs/runtime/run-transitions.js";

const now = "2026-10-06T00:00:00.000Z";
function setup() {
  const lead = agentRecordSchema.parse({
    id: "agent_lead",
    rootAgentId: "agent_lead",
    conversationId: "conv_team",
    projectId: "proj_team",
    projectDir: "/tmp/team",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/team"] },
    budget: { maxDepth: 4, maxConcurrentChildren: 4 },
    createdAt: now,
    updatedAt: now,
  });
  const agents = new Map([[lead.id, lead]]);
  const controls = new Map<string, AsyncSubagentControl>();
  const runs = new Map<string, RunRecord>();
  const assignments = new Map<string, AsyncSubagentAssignment>();
  const obligations: string[] = [];
  const queue = new Map<string, AgentInputQueueState>();
  let sequence = 0;
  let enabled = true;
  let cancelGate: Promise<void> | undefined;
  const inputs = new AgentInputService(
    {
      load: async (id) => structuredClone(queue.get(id)),
      save: async (id, state) => {
        queue.set(id, structuredClone(state));
      },
    },
    { next: () => String(++sequence) },
    { now: () => new Date(now) },
  );
  const configurationCalls: string[] = [];
  const delegation = new Map<string, ParentConfigurationSnapshot>();
  const ports: AsyncSubagentPorts = {
    getAgent: (id) => {
      const agent = agents.get(id);
      if (!agent) throw new Error("Missing agent");
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
    configuredModel: async () => undefined,
    readControl: async (id) =>
      controls.get(id) ?? {
        agentId: id,
        generation: 0,
        stopped: false,
        stopping: false,
      },
    writeControl: async (control) => {
      controls.set(control.agentId, control);
    },
    activeRun: async (agent) =>
      [...runs.values()].find(
        (run) =>
          run.agentId === agent.id &&
          !["completed", "failed", "cancelled"].includes(run.status),
      ),
    latestRun: async (agent) =>
      [...runs.values()].filter((run) => run.agentId === agent.id).at(-1),
    getRun: async (id) => runs.get(id),
    assignments: async () => [...assignments.values()],
    reserveAssignment: async (assignment) => {
      const old = assignments.get(assignment.runId);
      if (old) assert.deepEqual(old, assignment);
      assignments.set(assignment.runId, assignment);
    },
    registerObligation: async (obligation) => {
      if (!obligations.includes(obligation.id)) obligations.push(obligation.id);
    },
    controlGeneration: (id) => inputs.controlGeneration(id),
    delegationSnapshot: async (id, key) => delegation.get(`${id}:${key}`),
    steer: (agent, text, snapshot) => {
      const key = snapshot
        ? `parent:${snapshot.source.toolCallId}`
        : `parent-${++sequence}`;
      if (snapshot) delegation.set(`${agent.id}:${key}`, snapshot);
      return inputs.accept(
        agent.id,
        agent.conversationId,
        {
          text,
          role: "user",
          origin: {
            kind: "parent",
            agentId: agent.parentAgentId!,
            runId: snapshot?.source.runId,
          },
          idempotencyKey: key,
          eligibility: { kind: "next_turn" },
          activation: "wake_if_idle",
        },
        async () => {},
      );
    },
    resume: async () => {},
    configure: async (agent, _parent, request) => {
      configurationCalls.push(agent.id);
      agents.set(agent.id, { ...agent, ...request });
    },
    cancel: async (agent) => {
      await cancelGate;
      for (const run of runs.values())
        if (run.agentId === agent.id)
          runs.set(run.runId, { ...run, status: "cancelled" });
    },
    cancelForShutdown: async (agent) => {
      for (const run of runs.values())
        if (run.agentId === agent.id)
          runs.set(run.runId, { ...run, status: "cancelled" });
    },
    activeTaskCount: () => 0,
    completion: async (run) => ({
      agentId: run.agentId,
      runId: run.runId,
      attemptId: run.executionId,
      outcome: run.status as "completed",
      completedAt: now,
    }),
  };
  const service = new AsyncSubagentService(ports);
  const active = (
    agentId: string,
    runId: string,
    status: RunRecord["status"] = "running",
  ) => {
    const agent = agents.get(agentId)!;
    const run = {
      ...newRun(
        { ...agent, agentId, runId },
        `${agent.conversationId}:${agent.id}`,
        now,
        { next: () => runId },
      ),
      status,
    };
    runs.set(runId, run);
    return run;
  };
  return {
    service,
    ports,
    lead,
    agents,
    controls,
    runs,
    assignments,
    obligations,
    inputs,
    configurationCalls,
    active,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    gateCancel: (gate: Promise<void>) => {
      cancelGate = gate;
    },
  };
}

async function child(f: ReturnType<typeof setup>, name = "API") {
  return f.service.create(f.lead.id, name, true);
}
async function pending(f: ReturnType<typeof setup>, id: string) {
  return f.inputs.list(id);
}

describe("shared parent controls and durable admission policy", () => {
  it("creates configured reusable children without a private execution path", async () => {
    const f = setup();
    const view = await child(f);
    const agent = f.agents.get(view.agentId)!;
    assert.equal(agent.orchestrationPolicy?.preset, "developer");
    assert.equal(agent.projectDir, f.lead.projectDir);
    assert.equal(agent.parentAgentId, f.lead.id);
    await assert.rejects(child(f, " api "), /already exists/);
  });
  it("accepts concurrent user and parent steering for one busy child in one durable queue", async () => {
    const f = setup();
    const view = await child(f);
    f.active(view.agentId, "run_busy");
    const [parent, user] = await Promise.all([
      f.service.prompt(f.lead.id, "API", "parent steering"),
      f.inputs.accept(
        view.agentId,
        f.lead.conversationId,
        {
          text: "user steering",
          role: "user",
          origin: { kind: "user", userId: "user_test" },
          idempotencyKey: "user-one",
          eligibility: { kind: "next_turn" },
          activation: "wake_if_idle",
        },
        async () => {},
      ),
    ]);
    assert.equal(parent.runId, "run_busy");
    assert.ok(parent.inputId);
    assert.notEqual(parent.inputId, user.id);
    const accepted = await pending(f, view.agentId);
    assert.equal(accepted.length, 2);
    assert.deepEqual(
      accepted.map((input) => input.sequence),
      [0, 1],
    );
    assert.equal(f.runs.size, 1);
  });
  it("serializes capacity reservation across DIFFERENT children and releases failed admission", async () => {
    const f = setup();
    f.agents.set(f.lead.id, {
      ...f.lead,
      budget: { ...f.lead.budget!, maxConcurrentChildren: 1 },
    });
    const a = await child(f, "A"),
      b = await child(f, "B");
    await f.service.prompt(f.lead.id, "A", "a");
    await f.service.prompt(f.lead.id, "B", "b");
    const outcomes = await Promise.allSettled([
      f.service.reserveAdmission({
        agentId: a.agentId,
        runId: "run_a",
        inputs: await pending(f, a.agentId),
      }),
      f.service.reserveAdmission({
        agentId: b.agentId,
        runId: "run_b",
        inputs: await pending(f, b.agentId),
      }),
    ]);
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      (await pending(f, a.agentId)).length +
        (await pending(f, b.agentId)).length,
      2,
    );
    const winner = outcomes[0]!.status === "fulfilled" ? a : b;
    const runId = winner === a ? "run_a" : "run_b";
    await f.service.releaseAdmission({ agentId: winner.agentId, runId });
    assert.equal(f.controls.get(winner.agentId)?.reservedRunId, undefined);
    const other = winner === a ? b : a;
    await f.service.reserveAdmission({
      agentId: other.agentId,
      runId: "run_retry",
      inputs: await pending(f, other.agentId),
    });
  });
  it("preserves committed uncertain reservation across restart and releases absent reservation", async () => {
    const f = setup();
    const view = await child(f);
    await f.service.prompt(f.lead.id, "API", "work");
    await f.service.reserveAdmission({
      agentId: view.agentId,
      runId: "run_uncertain",
      inputs: await pending(f, view.agentId),
    });
    f.active(view.agentId, "run_uncertain", "interrupted");
    const restarted = new AsyncSubagentService(f.ports);
    await restarted.reconcile();
    assert.equal(f.controls.get(view.agentId)?.reservedRunId, "run_uncertain");
    await restarted.releaseAdmission({
      agentId: view.agentId,
      runId: "run_uncertain",
    });
    assert.equal(f.controls.get(view.agentId)?.reservedRunId, "run_uncertain");
    f.runs.delete("run_uncertain");
    await restarted.reconcile();
    assert.equal(f.controls.get(view.agentId)?.reservedRunId, undefined);
    await restarted.reserveAdmission({
      agentId: view.agentId,
      runId: "run_recovered",
      inputs: await pending(f, view.agentId),
    });
  });
  it("checks team stop and child pause at queued admission, preserving accepted input", async () => {
    const f = setup();
    const view = await child(f);
    await f.service.stopTeam(f.lead.id);
    const receipt = await f.service.prompt(
      f.lead.id,
      "API",
      "queued while stopped",
    );
    assert.ok(receipt.inputId);
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: view.agentId,
        runId: "run_stale",
        inputs: await pending(f, view.agentId),
      }),
      /paused/,
    );
    await f.service.prompt(f.lead.id, "API", "explicit restart", {
      resume: true,
    });
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: view.agentId,
        runId: "run_parent_still_paused",
        inputs: await pending(f, view.agentId),
      }),
      /paused/,
    );
    assert.equal(f.controls.get(f.lead.id)?.stopped, true);
    await f.service.reopen(f.lead.id);
    await f.service.reserveAdmission({
      agentId: view.agentId,
      runId: "run_resumed",
      inputs: await pending(f, view.agentId),
    });
    assert.equal((await pending(f, view.agentId)).length, 2);
  });
  it("does not reserve a replacement while cancellation is still settling", async () => {
    const f = setup();
    const view = await child(f);
    f.active(view.agentId, "run_original");
    let release!: () => void;
    f.gateCancel(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const stopping = f.service.stop(f.lead.id, "API");
    while (!f.controls.get(view.agentId)?.stopping) await Promise.resolve();
    await f.service.prompt(f.lead.id, "API", "next");
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: view.agentId,
        runId: "run_replace",
        inputs: await pending(f, view.agentId),
      }),
      /paused/,
    );
    release();
    await stopping;
    assert.equal((await pending(f, view.agentId)).length, 1);
  });
  it("commits exact assignment correlation once and stale release cannot erase another reservation", async () => {
    const f = setup();
    const view = await child(f);
    await f.service.reserveAdmission({
      agentId: view.agentId,
      runId: "run_first",
      inputs: [],
    });
    f.active(view.agentId, "run_first");
    await f.service.commitAdmission({
      agentId: view.agentId,
      runId: "run_first",
    });
    await f.service.commitAdmission({
      agentId: view.agentId,
      runId: "run_first",
    });
    assert.deepEqual(f.obligations, ["async_subagent:run_first:0"]);
    assert.equal(f.controls.get(view.agentId)?.reservedRunId, undefined);
    f.runs.set("run_first", {
      ...f.runs.get("run_first")!,
      status: "completed",
    });
    await f.service.reserveAdmission({
      agentId: view.agentId,
      runId: "run_second",
      inputs: [],
    });
    await f.service.releaseAdmission({
      agentId: view.agentId,
      runId: "run_first",
    });
    assert.equal(f.controls.get(view.agentId)?.reservedRunId, "run_second");
  });
  it("allows parent prompt/configure/stop for Explore children by persistent ID without developer membership", async () => {
    const f = setup();
    const view = await child(f);
    const agent = f.agents.get(view.agentId)!;
    f.agents.set(agent.id, {
      ...agent,
      name: undefined,
      orchestrationPolicy: {
        preset: "explore",
        parentCancellation: "attached",
        completionReporting: "parent",
      },
      readOnlyCeiling: true,
      permissionLevel: "read_only",
    });
    await f.service.prompt(f.lead.id, agent.id, "focus here", {
      configuration: { instructions: "check paths" },
    });
    assert.deepEqual(f.configurationCalls, [agent.id]);
    assert.equal((await pending(f, agent.id))[0]?.text, "focus here");
    await f.service.stop(f.lead.id, agent.id);
    assert.equal(f.controls.get(agent.id)?.stopped, true);
  });
  it("enforces parent grants separately from direct user administration", async () => {
    const f = setup();
    const view = await child(f);
    const agent = f.agents.get(view.agentId)!;
    f.agents.set(agent.id, {
      ...agent,
      parentGrants: { prompt: false, configure: false, stop: false },
    });
    await assert.rejects(
      f.service.prompt(f.lead.id, agent.id, "parent"),
      /target grant/,
    );
    await assert.rejects(f.service.stop(f.lead.id, agent.id), /target grant/);
    f.setEnabled(false);
    const user = await f.inputs.accept(
      agent.id,
      agent.conversationId,
      {
        role: "user",
        origin: { kind: "user", userId: "user" },
        text: "administrative input",
        idempotencyKey: "direct-user",
        eligibility: { kind: "next_turn" },
        activation: "wake_if_idle",
      },
      async () => {},
    );
    await f.service.reserveAdmission({
      agentId: agent.id,
      runId: "run_user",
      inputs: [user],
    });
  });
  it("retains original accepted delegation scope after ordinary parent configuration changes and across queued restart", async () => {
    const f = setup();
    const view = await child(f);
    const snapshot: ParentConfigurationSnapshot = {
      agentId: f.lead.id,
      configurationRevision: 1,
      configuration: agentConfigurationSchema.parse(f.lead),
      source: {
        runId: "run_parent",
        attemptId: "exec_parent",
        toolCallId: "tool_assign",
      },
    };
    const receipt = await f.service.prompt(
      f.lead.id,
      view.agentId,
      "queued original scope",
      { parentSnapshot: snapshot },
    );
    f.agents.set(f.lead.id, {
      ...f.lead,
      configurationRevision: 2,
      projectDir: "/tmp/new",
      workspaceScope: { roots: ["/tmp/new"] },
      mode: "planning",
      permissionLevel: "read_only",
    });
    await new AsyncSubagentService(f.ports).reserveAdmission({
      agentId: view.agentId,
      runId: "run_after_restart",
      inputs: await pending(f, view.agentId),
    });
    assert.ok(receipt.inputId);
    assert.equal(
      f.controls.get(view.agentId)?.reservedRunId,
      "run_after_restart",
    );
  });
  it("does not use automatic spawn approval to amplify a custom parent permission policy", async () => {
    const f = setup();
    f.agents.set(f.lead.id, { ...f.lead, permissionRuleSetId: "restricted" });
    const view = await f.service.create(f.lead.id, "restricted child", false);
    assert.equal(f.agents.get(view.agentId)?.permissionRuleSetId, "restricted");
  });
  it("keeps historical orphans administrable while rejecting new authority from a removed parent", async () => {
    const f = setup();
    const view = await child(f);
    f.agents.delete(f.lead.id);
    await f.service.reserveAdmission({
      agentId: view.agentId,
      runId: "run_orphan_user",
      inputs: [],
    });
    const parent = {
      role: "user",
      origin: { kind: "parent", agentId: f.lead.id },
      text: "stale parent",
      idempotencyKey: "stale",
      eligibility: { kind: "next_turn" },
      activation: "wake_if_idle",
    } as const;
    const input = await f.inputs.accept(
      view.agentId,
      f.lead.conversationId,
      parent,
      async () => {},
    );
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: view.agentId,
        runId: "run_stale_parent",
        inputs: [input],
      }),
      /no longer exists/,
    );
  });
  it("independent explicit administration proof survives policy restart without reopening parent/siblings and is invalidated by newer team stop", async () => {
    const f = setup();
    const first = await child(f, "First"),
      sibling = await child(f, "Other");
    await f.service.stopTeam(f.lead.id);
    await f.service.resume(first.agentId);
    await f.service.recordAdministrativeActivation({
      agentId: first.agentId,
      generation: await f.inputs.controlGeneration(first.agentId),
      cause: "user_resume",
    });
    const input = await f.inputs.accept(
      first.agentId,
      f.lead.conversationId,
      {
        text: "user independently resumes",
        role: "user",
        origin: { kind: "user", userId: "local" },
        idempotencyKey: "admin_resume",
        eligibility: { kind: "next_turn" },
        activation: "wake_if_idle",
      },
      async () => {},
    );
    await new AsyncSubagentService(f.ports).reserveAdmission({
      agentId: first.agentId,
      runId: "run_admin",
      inputs: [input],
    });
    assert.equal(f.controls.get(f.lead.id)?.stopped, true);
    assert.equal(f.controls.get(sibling.agentId)?.stopped, true);
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: sibling.agentId,
        runId: "run_auto_sibling",
        inputs: [],
      }),
      /paused/,
    );
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: f.lead.id,
        runId: "run_completion_parent",
        inputs: [],
      }),
      /paused/,
    );
    await f.service.releaseAdmission({
      agentId: first.agentId,
      runId: "run_admin",
    });
    await f.service.reserveAdmission({
      agentId: first.agentId,
      runId: "run_admin_retry",
      inputs: [input],
    });
    f.active(first.agentId, "run_admin_retry", "completed");
    await f.service.commitAdmission({
      agentId: first.agentId,
      runId: "run_admin_retry",
    });
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: first.agentId,
        runId: "run_old_auto",
        inputs: [],
      }),
      /paused/,
    );
    const previousTeamGeneration = f.controls.get(f.lead.id)!.generation;
    await f.service.stopTeam(f.lead.id);
    await f.service.resume(first.agentId);
    assert.ok(f.controls.get(f.lead.id)!.generation > previousTeamGeneration);
    await assert.rejects(
      f.service.reserveAdmission({
        agentId: first.agentId,
        runId: "run_stale_admin",
        inputs: [input],
      }),
      /paused/,
    );
  });
  it("graceful shutdown does not persist a user pause or discard accepted general input", async () => {
    const f = setup();
    const view = await child(f);
    await f.service.prompt(f.lead.id, "API", "pending");
    f.active(view.agentId, "run_active");
    await f.service.settleTeam(f.lead.id);
    assert.equal(f.controls.get(view.agentId)?.stopped, false);
    assert.equal((await pending(f, view.agentId)).length, 1);
    await new AsyncSubagentService(f.ports).reconcile();
    await f.service.reserveAdmission({
      agentId: view.agentId,
      runId: "run_restart",
      inputs: await pending(f, view.agentId),
    });
  });
});
