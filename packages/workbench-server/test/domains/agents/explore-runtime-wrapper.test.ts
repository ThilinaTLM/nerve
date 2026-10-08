import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type {
  AgentCompletion,
  AgentRecord,
  CreateAgentRequest,
} from "@nervekit/contracts/agents";
import {
  SubagentRunner,
  type ExploreRuntime,
  type ExploreRunIdentity,
  type SubagentRunnerDeps,
  type SubagentRunSpec,
} from "../../../src/domains/agents/execution/subagent-runner.js";
import { WorkbenchExploreAdmission } from "../../../src/domains/agents/execution/workbench-explore-admission.js";
import { WorkbenchSubagentExecutions } from "../../../src/domains/agents/execution/workbench-subagent-executions.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const parent: AgentRecord = {
  id: "agent_parent",
  conversationId: "conv_shared",
  projectId: "proj_test",
  projectDir: "/source",
  rootAgentId: "agent_parent",
  mode: "coding",
  permissionLevel: "autonomous",
  workspaceScope: { roots: ["/source"] },
  budget: { depth: 0, maxDepth: 3 },
  thinkingLevel: "off",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function completion(
  run: ExploreRunIdentity,
  text = "Original submitted-run result",
): AgentCompletion {
  return {
    ...run,
    outcome: "completed",
    completedAt: new Date().toISOString(),
    response: {
      entryId: "entry_result",
      runId: run.runId,
      text,
      complete: true,
    },
  };
}
function fixture(
  runtime: ExploreRuntime,
  home = "/tmp",
  executions = new WorkbenchSubagentExecutions(),
) {
  const requests: CreateAgentRequest[] = [];
  const runner = new SubagentRunner({
    storage: { paths: { home } } as SubagentRunnerDeps["storage"],
    events: {
      publish: async () => undefined,
    } as unknown as SubagentRunnerDeps["events"],
    logger: {
      warn: async () => undefined,
    } as unknown as SubagentRunnerDeps["logger"],
    capabilities: {
      settings: async () => ({ exploreAgent: {} }),
    } as unknown as SubagentRunnerDeps["capabilities"],
    createAgent: async (request) => {
      requests.push(request);
      return {
        ...parent,
        ...request,
        id: `agent_child_${requests.length}`,
        thinkingLevel: request.thinkingLevel ?? "off",
        budget: { depth: 1, maxDepth: 3 },
      } as AgentRecord;
    },
    runtime,
    executions,
    exploreAdmission: new WorkbenchExploreAdmission(1),
  });
  const spec: SubagentRunSpec = {
    kind: "explore",
    parent,
    projectId: parent.projectId,
    projectDir: parent.projectDir,
    mode: "coding",
    permissionLevel: "read_only",
    prompt: "Only this fresh assignment",
    systemPrompt: "Read-only research",
    historyMode: "fresh",
  };
  return { runner, requests, spec };
}
function identity(agentId: string): ExploreRunIdentity {
  return { agentId, runId: `run_${agentId}`, attemptId: `attempt_${agentId}` };
}

it("creates a fresh persistent read-only blueprint and returns the exact submitted run, not later child output", async () => {
  const waiting = deferred<AgentCompletion>();
  const submitted = deferred<ExploreRunIdentity>();
  const f = fixture({
    submitRun: async (id, text, origin) => {
      assert.equal(text, "Only this fresh assignment");
      assert.equal(origin.agentId, parent.id);
      const run = identity(id);
      submitted.resolve(run);
      return run;
    },
    waitForRun: async (run) => {
      assert.deepEqual(run, identity("agent_child_1"));
      return waiting.promise;
    },
    cancelRun: async () => {
      assert.fail("must not cancel");
    },
  });
  const result = f.runner.runSubagent(f.spec);
  const run = await submitted.promise;
  const request = f.requests[0]!;
  assert.equal(request.conversationId, parent.conversationId);
  assert.equal(request.parentAgentId, parent.id);
  assert.equal(Object.hasOwn(request, "executionKind"), false);
  assert.equal(request.readOnlyCeiling, true);
  assert.equal(request.permissionLevel, "read_only");
  assert.deepEqual(request.workspaceScope, {
    roots: ["/source"],
    readonly: true,
  });
  assert.deepEqual(request.orchestrationPolicy, {
    preset: "explore",
    parentCancellation: "attached",
    completionReporting: "none",
  });
  assert.ok(request.tools?.includes("read"));
  // A subsequent execution/configuration can exist while the original wait is unresolved.
  waiting.resolve(
    completion(run, "Original result, not mutable latest output"),
  );
  assert.equal(
    (await result).report,
    "Original result, not mutable latest output",
  );
  await assert.rejects(
    f.runner.runSubagent({ ...f.spec, historyMode: "copy_parent" }),
    /fresh agent context/,
  );
  assert.equal(f.requests.length, 1);
});

it("rejects mismatched agent and run completion snapshots", async () => {
  for (const field of ["agentId", "runId"] as const) {
    const f = fixture({
      submitRun: async (id) => identity(id),
      waitForRun: async (run) => ({
        ...completion(run),
        [field]: "other_identity",
      }),
      cancelRun: async () => undefined,
    });
    const result = await f.runner.runSubagent(f.spec);
    assert.equal(result.status, "failed");
    assert.match(result.report, /does not match the submitted run/);
  }
});

it("forwards abort during admission to the exact run and waits for terminal settlement", async () => {
  const controller = new AbortController();
  const admission = deferred<ExploreRunIdentity>();
  const terminal = deferred<AgentCompletion>();
  const cancelled = deferred<ExploreRunIdentity>();
  const admitting = deferred<void>();
  const f = fixture({
    submitRun: async (_id, _text, _parent, options) => {
      assert.equal(options?.signal, controller.signal);
      admitting.resolve();
      return admission.promise;
    },
    waitForRun: async () => terminal.promise,
    cancelRun: async (run) => {
      cancelled.resolve(run);
    },
  });
  let finished = false;
  const result = f.runner
    .runSubagent({ ...f.spec, signal: controller.signal })
    .finally(() => {
      finished = true;
    });
  // Admission has started but has not yet yielded an identity.
  await admitting.promise;
  controller.abort();
  const run = identity("agent_child_1");
  admission.resolve(run);
  assert.deepEqual(await cancelled.promise, run);
  assert.equal(finished, false);
  terminal.resolve({
    ...completion(run),
    outcome: "cancelled",
    response: undefined,
  });
  await assert.rejects(result, { name: "AbortError" });
});

it("cancellation while waiting for Explore capacity creates no child or run", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-explore-capacity-abort-"));
  const submitted = deferred<ExploreRunIdentity>();
  const terminal = deferred<AgentCompletion>();
  const waiting = deferred<void>();
  const controller = new AbortController();
  let submissions = 0;
  const f = fixture(
    {
      submitRun: async (id) => {
        submissions++;
        const run = identity(id);
        submitted.resolve(run);
        return run;
      },
      waitForRun: async () => terminal.promise,
      cancelRun: async () =>
        assert.fail("queued cancellation must not cancel the active sibling"),
    },
    home,
  );
  const args = {
    context: "Initial inspection identified independent readonly source work.",
    tasks: [
      {
        task: "Inspect this independent source area without changing files",
        label: "Read source",
      },
    ],
  };
  try {
    const active = f.runner.runExplore(parent, args);
    const run = await submitted.promise;
    const queued = f.runner.runExplore(parent, args, {
      signal: controller.signal,
      onProgress: (update) => {
        if (update.message.includes("waiting for an active-agent slot"))
          waiting.resolve();
      },
    });
    const cancelled = assert.rejects(queued, { name: "AbortError" });
    await waiting.promise;
    controller.abort();
    await cancelled;
    assert.equal(submissions, 1);
    assert.equal(f.requests.length, 1);
    terminal.resolve(completion(run));
    assert.equal((await active).reports[0]?.status, "completed");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("bounds admission through settlement, settles every sibling and preserves partial-failure reports", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-explore-wrapper-"));
  try {
    const first = deferred<AgentCompletion>();
    const started = deferred<ExploreRunIdentity>();
    let active = 0;
    let peak = 0;
    let count = 0;
    const f = fixture(
      {
        submitRun: async (id) => {
          active++;
          peak = Math.max(peak, active);
          count++;
          const run = identity(id);
          if (count === 1) started.resolve(run);
          return run;
        },
        waitForRun: async (run) => {
          const value =
            count === 1
              ? await first.promise
              : {
                  ...completion(run),
                  outcome: "failed" as const,
                  response: undefined,
                };
          active--;
          return value;
        },
        cancelRun: async () => undefined,
      },
      home,
    );
    const result = f.runner.runExplore(parent, {
      context:
        "Initial lookup found two independent areas needing verification.",
      split_rationale:
        "These tasks concern independent files and can produce separate reports.",
      tasks: [
        {
          task: "Inspect the first independent source area",
          label: "First source area",
        },
        {
          task: "Inspect the second independent source area",
          label: "Second source area",
        },
      ],
    });
    const run = await started.promise;
    assert.equal(f.requests.length, 1);
    first.resolve(completion(run));
    const output = await result;
    assert.equal(peak, 1);
    assert.equal(count, 2);
    assert.deepEqual(
      output.reports.map((report) => report.status),
      ["completed", "failed"],
    );
    assert.ok(output.reports.every((report) => report.reportPath));
    assert.equal(output.details.outputLimits.artifacts.length, 2);
    assert.match(
      output.contentBlocks[0].text,
      /First source area|Original submitted-run result/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("parent cancellation attachments wait on the original run without stopping a later child run", async () => {
  const terminal = deferred<AgentCompletion>();
  const started = deferred<ExploreRunIdentity>();
  const cancelled: ExploreRunIdentity[] = [];
  const executions = new WorkbenchSubagentExecutions();
  const f = fixture(
    {
      submitRun: async (id) => {
        const run = identity(id);
        started.resolve(run);
        return run;
      },
      waitForRun: async () => terminal.promise,
      cancelRun: async (run) => {
        cancelled.push(run);
      },
    },
    "/tmp",
    executions,
  );
  const output = f.runner.runSubagent({ ...f.spec, parentRunId: "run_parent" });
  const run = await started.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  let parentSettled = false;
  const stopping = executions.cancelRun("run_parent").then((count) => {
    parentSettled = true;
    return count;
  });
  assert.deepEqual(cancelled, [run]);
  assert.equal(parentSettled, false);
  terminal.resolve({
    ...completion(run),
    outcome: "cancelled",
    response: undefined,
  });
  await assert.rejects(output, { name: "AbortError" });
  assert.equal(await stopping, 1);
  assert.equal(await executions.cancelRun("run_parent"), 0);
});

it("accepts same-run safe retry proof and returns immutable effective-run metadata", async () => {
  const usage = {
    input: 100,
    output: 25,
    cacheRead: 5,
    cacheWrite: 0,
    totalTokens: 125,
    cost: 0.01,
    turns: 2,
  };
  const steps = [
    {
      type: "tool_result" as const,
      toolName: "read",
      message: "Read original-run evidence",
    },
  ];
  const f = fixture({
    submitRun: async (id) => identity(id),
    waitForRun: async (run) => ({
      ...completion(run),
      submittedAttemptId: run.attemptId,
      attemptId: "attempt_safe_retry",
      usage,
      steps,
      model: "effective-provider/effective-model",
      modelSelection: {
        provider: "effective-provider",
        modelId: "effective-model",
      },
      thinkingLevel: "high",
      stopReason: "stop",
    }),
    cancelRun: async () => undefined,
  });
  const result = await f.runner.runSubagent({
    ...f.spec,
    model: { provider: "initial-provider", modelId: "initial-model" },
    thinkingLevel: "off",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.model, "effective-provider/effective-model");
  assert.equal(result.thinkingLevel, "high");
  assert.deepEqual(result.usage, usage);
  assert.deepEqual(result.steps, steps);
  assert.equal(result.stopReason, "stop");
});

it("rejects a newer run or invalid submitted-attempt proof despite successful terminal output", async () => {
  for (const mismatch of ["run", "submission"] as const) {
    const f = fixture({
      submitRun: async (id) => identity(id),
      waitForRun: async (run) => ({
        ...completion(run),
        submittedAttemptId:
          mismatch === "submission" ? "attempt_stale" : run.attemptId,
        attemptId: "attempt_retry",
        runId: mismatch === "run" ? "run_newer_assignment" : run.runId,
      }),
      cancelRun: async () => undefined,
    });
    const result = await f.runner.runSubagent(f.spec);
    assert.equal(result.status, "failed");
    assert.match(result.errorMessage ?? "", /does not match/);
    assert.equal(result.usage, undefined);
  }
});

it("keeps a planning parent's Explore child in authorized planning mode with immutable readonly authority", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-explore-planning-"));
  try {
    const f = fixture(
      {
        submitRun: async (id) => identity(id),
        waitForRun: async (run) => completion(run),
        cancelRun: async () => undefined,
      },
      home,
    );
    await f.runner.runExplore(
      { ...parent, mode: "planning" },
      {
        context:
          "Initial inspection found one source area requiring deeper readonly evidence.",
        tasks: [
          {
            task: "Inspect planning-safe source behavior without modifying files",
            label: "Planning-safe behavior",
          },
        ],
      },
    );
    assert.equal(f.requests[0]?.mode, "planning");
    assert.equal(f.requests[0]?.permissionLevel, "read_only");
    assert.equal(f.requests[0]?.readOnlyCeiling, true);
    assert.equal(f.requests[0]?.workspaceScope?.readonly, true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("does not confuse a legacy same-run terminal retry attempt with the submitted attempt", async () => {
  const f = fixture({
    submitRun: async (id) => identity(id),
    waitForRun: async (run) => ({
      ...completion(run),
      attemptId: "attempt_terminal_retry",
    }),
    cancelRun: async () => undefined,
  });
  const result = await f.runner.runSubagent(f.spec);
  assert.equal(result.status, "completed");
  assert.equal(result.report, "Original submitted-run result");
});
