import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentCompletion } from "@nervekit/contracts/agents";
import type { RunHydratedState } from "../../../src/domains/runs/runtime/run-unit-of-work.js";
import { AgentCompletionService } from "../../../src/domains/agents/agent-completion.service.js";

const now = "2026-10-06T00:00:00.000Z";
function fixture() {
  const run = {
    agentId: "agent_child",
    runId: "run_original",
    executionId: "exec_final",
    status: "completed",
    updatedAt: now,
    terminalAt: now,
  };
  const response = {
    id: "entry_original",
    agentId: run.agentId,
    runId: run.runId,
    turnId: "turn_original",
    role: "assistant",
    kind: "message",
    text: "original result",
    createdAt: now,
    usage: {
      input: 2,
      output: 3,
      cacheRead: 4,
      cacheWrite: 0,
      totalTokens: 9,
      cost: 0.01,
    },
  };
  const snapshots = new Map<string, AgentCompletion>();
  const configuration = {
    projectDir: "/tmp",
    mode: "coding",
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    workspaceScope: { roots: ["/tmp"] },
    model: { provider: "original", modelId: "snapshot" },
    thinkingLevel: "high",
    systemPrompt: "original instructions",
    tools: [],
    skills: [],
  };
  const turns = [
    {
      agentId: run.agentId,
      runId: run.runId,
      attemptId: run.executionId,
      turnId: response.turnId,
      configurationRevision: 2,
      configurationProvenance: "resolved",
      acceptedConfiguration: configuration,
      configuration,
    },
  ];
  let state = {
    run,
    transitions: [
      {
        revision: 1,
        toolCalls: [],
        run: { ...run, executionId: "exec_initial" },
        entries: [
          { ...response, id: "entry_old_attempt", text: "old attempt" },
        ],
      },
      {
        revision: 2,
        toolCalls: [],
        run,
        entries: [response],
        execution: { effectiveTurnConfigurations: turns },
      },
    ],
  } as unknown as RunHydratedState;
  const ports = {
    loadRun: async () => state,
    readSnapshot: async (_agentId: string, runId: string) =>
      snapshots.get(runId),
    writeSnapshot: async (value: AgentCompletion) => {
      snapshots.set(value.runId, structuredClone(value));
    },
  };
  return {
    service: new AgentCompletionService(ports),
    ports,
    run,
    snapshots,
    setState: (value: RunHydratedState) => {
      state = value;
    },
    state,
  };
}

it("captures exact terminal attempt and original metadata independent of later history/config/branch", async () => {
  const f = fixture();
  const completion = await f.service.snapshot(
    "agent_child",
    "run_original",
    "exec_initial",
  );
  assert.equal(completion.attemptId, "exec_final");
  assert.equal(completion.submittedAttemptId, "exec_initial");
  assert.equal(completion.response?.text, "original result");
  assert.equal(completion.usage?.totalTokens, 18);
  assert.equal(completion.usage?.turns, 2);
  assert.equal(completion.model, "original/snapshot");
  assert.equal(completion.thinkingLevel, "high");
  await assert.rejects(
    f.service.snapshot("agent_child", "run_original", "exec_stale"),
    /submitted attempt/,
  );
  f.setState({ ...f.state, transitions: [] } as RunHydratedState);
  const recovered = await new AgentCompletionService(f.ports).snapshot(
    "agent_child",
    "run_original",
    "exec_initial",
  );
  assert.deepEqual(recovered, completion);
});

it("does not relabel an earlier attempt output when a retry failed without output", async () => {
  const f = fixture();
  f.setState({
    ...f.state,
    run: { ...f.state.run, status: "failed" },
    transitions: f.state.transitions.slice(0, 1),
  });
  const completion = await f.service.snapshot(
    "agent_child",
    "run_original",
    "exec_initial",
  );
  assert.equal(completion.outcome, "failed");
  assert.equal(completion.attemptId, "exec_final");
  assert.equal(completion.response, undefined);
  assert.equal(completion.model, undefined);
  assert.equal(completion.thinkingLevel, undefined);
});

it("rejects nonterminal and wrong-agent result lookup", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.snapshot("agent_sibling", "run_original"),
    /submitted agent/,
  );
  f.setState({ ...f.state, run: { ...f.state.run, status: "running" } });
  await assert.rejects(
    f.service.snapshot("agent_child", "run_original"),
    /settled/,
  );
});

it("uses only owned terminal-attempt transition provenance, not unrelated or prior-attempt settings", async () => {
  const f = fixture();
  const terminal = f.state.transitions[1]!;
  const effective = terminal.execution!.effectiveTurnConfigurations![0]!;
  const foreign = [
    { ...effective, agentId: "agent_foreign" },
    { ...effective, runId: "run_foreign" },
    { ...effective, attemptId: "exec_initial" },
  ];
  f.setState({
    ...f.state,
    transitions: [
      {
        ...f.state.transitions[0]!,
        execution: {
          ...terminal.execution!,
          effectiveTurnConfigurations: [
            { ...effective, attemptId: "exec_initial" },
          ],
        },
      },
      {
        ...terminal,
        execution: {
          ...terminal.execution!,
          effectiveTurnConfigurations: foreign,
        },
      },
    ],
  });
  const completion = await f.service.snapshot(
    "agent_child",
    "run_original",
    "exec_initial",
  );
  assert.equal(completion.response?.text, "original result");
  assert.equal(completion.model, undefined);
  assert.equal(completion.thinkingLevel, undefined);
});
