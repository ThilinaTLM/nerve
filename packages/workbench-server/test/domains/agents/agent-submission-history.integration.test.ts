import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import type { RunRecord } from "@nervekit/contracts/runs";
import {
  createRuntimeFixture,
  type RuntimeFixture,
} from "../../support/runtime-fixture.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import {
  initializeStorage,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { WorkbenchRunUnitOfWork } from "../../../src/domains/runs/persistence/run-transition.repository.js";
import { WorkbenchRunIntegrity } from "../../../src/domains/runs/adapters/workbench-run-integrity.js";
import { buildTransition } from "../../../src/domains/runs/runtime/index.js";

const retained = `UNRELATED_HISTORY_ONLY:${"h".repeat(64 * 1024)}`;

async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out awaiting scaled submission lifecycle");
}

// Use the same real composition/provider fixture as Explore transcript isolation.
// History is written through the run owner, never fabricated SQL or user exports.
async function seedHistory(
  runtime: RuntimeFixture,
  storage: Awaited<ReturnType<typeof initializeStorage>>,
  home: string,
  provider: string,
) {
  const project = await runtime.services.projectLifecycle.createProject({
    dir: home,
  });
  const journal = new ConversationJournalRepository(storage);
  const runs = new WorkbenchRunUnitOfWork(journal, 0);
  const historicalIds = new Set<string>();
  let sequence = 0;
  try {
    for (let actor = 0; actor < 16; actor++) {
      const conversation =
        await runtime.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const agent = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider, modelId: "scripted-fast" },
      });
      for (let history = 0; history < 8; history++) {
        const runId = `run_history_${actor}_${history}`;
        const timestamp = "2026-07-12T00:00:00.000Z";
        const run: RunRecord = {
          stateEpoch: 1,
          runId,
          conversationId: conversation.id,
          agentId: agent.id,
          projectId: project.id,
          scopeId: `${conversation.id}:${agent.id}`,
          revision: 1,
          initialInputId: `input_history_${actor}_${history}`,
          executionId: `exec_history_${actor}_${history}`,
          attempt: 1,
          status: "completed",
          recoverability: "not_needed",
          createdAt: timestamp,
          updatedAt: timestamp,
          startedAt: timestamp,
          terminalAt: timestamp,
          cancellationEvidence: [],
        };
        await runs.commit(
          0,
          buildTransition(
            run,
            "completed",
            0,
            {
              entries: [
                {
                  id: `entry_history_${actor}_${history}`,
                  conversationId: conversation.id,
                  agentId: agent.id,
                  runId,
                  role: "assistant",
                  kind: "message",
                  text: retained,
                  createdAt: timestamp,
                },
              ],
            },
            { next: () => `history_${++sequence}` },
            new WorkbenchRunIntegrity(),
          ),
        );
        historicalIds.add(runId);
      }
      ConversationJournalRepository.invalidateMigratedConversation(
        storage.canonicalStore,
        conversation.id,
      );
    }
  } finally {
    await journal.close();
  }
  assert.equal(historicalIds.size, 128);
  return { project, historicalIds };
}

for (const reopened of [false, true]) {
  test(`Explore submission stays target-only with 128 large terminal histories (${reopened ? "reopened" : "fresh"} store)`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-submission-history-"));
    const parentProvider = `nerve-history-parent-${reopened}`;
    const childProvider = `nerve-history-child-${reopened}`;
    const parentRegistration = registerAgentScriptedProvider({
      provider: parentProvider,
      steps: [],
    });
    const childRegistration = registerAgentScriptedProvider({
      provider: childProvider,
      steps: [],
    });
    let storage = await initializeStorage(home);
    await writeSettings(storage, {
      exploreAgent: {
        model: { provider: childProvider, modelId: "scripted-fast" },
      },
    });
    let runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
    try {
      await runtime.lifecycle.hydrate();
      const { project, historicalIds } = await seedHistory(
        runtime,
        storage,
        home,
        parentProvider,
      );
      if (reopened) {
        await shutdownServerRuntime(runtime.runtime);
        storage = await initializeStorage(home);
        runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
        await runtime.lifecycle.hydrate();
      }

      // Activity publication owns an explicit workspace metadata scan; it is not
      // assignment correlation. Stop this observer, not any execution service.
      await runtime.services.agentActivityPublisher.stop();
      // Obligation notifications explicitly refresh this observer even after its
      // event subscription stops. Exclude those refreshes too, never execution.
      t.mock.method(
        runtime.services.agentActivityPublisher,
        "refresh",
        async () => undefined,
      );
      // Bootstrap/recovery may legitimately scan. Admission, waiting and Stop may not.
      const hydratedIds = new Set<string>();
      const legitimateRunIds = new Set<string>();
      const originalRead = CanonicalStore.prototype.readRunState;
      const originalActive = CanonicalStore.prototype.listRunStates;
      const historicalEnumerations: string[] = [];
      const forbidden = () => {
        historicalEnumerations.push(
          new Error("Historical enumeration").stack ?? "unknown caller",
        );
        assert.fail("Submission/cancellation enumerated historical runs");
      };
      t.mock.method(WorkbenchRunUnitOfWork.prototype, "list", forbidden);
      t.mock.method(
        WorkbenchRunUnitOfWork.prototype,
        "listMetadata",
        forbidden,
      );
      t.mock.method(CanonicalStore.prototype, "listRunMetadata", forbidden);
      t.mock.method(
        CanonicalStore.prototype,
        "listRunDeliveryRecoveryStates",
        forbidden,
      );
      t.mock.method(
        CanonicalStore.prototype,
        "listRunStates",
        async function (this: CanonicalStore, statuses: string[]) {
          assert.ok(
            statuses.every(
              (status) =>
                !["completed", "failed", "cancelled", "interrupted"].includes(
                  status,
                ),
            ),
          );
          const states = (await originalActive.call(this, statuses)) as {
            run: RunRecord;
          }[];
          for (const state of states) {
            assert.ok(
              !historicalIds.has(state.run.runId),
              `Enumerated unrelated history ${state.run.runId}`,
            );
            hydratedIds.add(state.run.runId);
          }
          return states;
        },
      );
      t.mock.method(
        CanonicalStore.prototype,
        "readRunState",
        function (this: CanonicalStore, runId: string) {
          assert.ok(
            !historicalIds.has(runId),
            `Hydrated unrelated history ${runId}`,
          );
          hydratedIds.add(runId);
          return originalRead.call(this, runId);
        },
      );

      for (const cancelled of [false, true]) {
        const conversation =
          await runtime.services.conversationLifecycle.createConversation({
            projectId: project.id,
          });
        const parent = await runtime.services.agentLifecycle.createAgent({
          projectId: project.id,
          conversationId: conversation.id,
          model: { provider: parentProvider, modelId: "scripted-fast" },
        });
        const tasks = Array.from({ length: 3 }, (_, index) => ({
          task: `ASSIGNMENT_${cancelled}_${index}`,
          label: `probe ${index}`,
        }));
        const payloads: string[] = [];
        let parentReportPayload = "";
        childRegistration.setResponses(
          tasks.map(() => async (context, options) => {
            const payload = JSON.stringify(context.messages);
            payloads.push(payload);
            const ownTask = tasks.find((task) => payload.includes(task.task));
            assert.ok(ownTask);
            assert.equal(
              tasks.filter((task) => payload.includes(task.task)).length,
              1,
              "fresh context includes only its own assignment",
            );
            assert.doesNotMatch(
              payload,
              /PARENT_PRIVATE_CONTEXT|UNRELATED_HISTORY_ONLY/,
            );
            assert.match(payload, /SHARED_EXPLORE_CONTEXT/);
            if (cancelled) {
              await new Promise<void>((resolve) => {
                if (options?.signal?.aborted) return resolve();
                options?.signal?.addEventListener("abort", () => resolve(), {
                  once: true,
                });
              });
            }
            return fauxAssistantMessage(`REPORT_${ownTask.task}`);
          }),
        );
        parentRegistration.setResponses([
          () =>
            fauxAssistantMessage([
              fauxToolCall(
                "explore",
                {
                  tasks,
                  context:
                    "SHARED_EXPLORE_CONTEXT: inspect the isolated fixture project without making changes.",
                  split_rationale:
                    "Three independent read-only probes exercise parallel runtime admission.",
                },
                { id: `explore_history_${cancelled}` },
              ),
            ]),
          (context) => {
            const payload = JSON.stringify(context.messages);
            parentReportPayload = payload;
            return fauxAssistantMessage("Parent received all three reports.");
          },
        ]);
        await runtime.services.workbenchRun.promptAgent(parent.id, {
          text: "PARENT_PRIVATE_CONTEXT: start the three Explore probes.",
        });
        const parentRunId = await eventually(
          async () =>
            (
              await runtime.services.workbenchRun.getAgentHistory(parent.id)
            ).find((entry) => entry.runId)?.runId,
        );
        legitimateRunIds.add(parentRunId);
        await eventually(async () =>
          payloads.length === 3 ? true : undefined,
        );
        const children = runtime.services.agentLifecycle
          .listAgents()
          .filter((agent) => agent.parentAgentId === parent.id);
        assert.equal(children.length, 3);
        for (const child of children) {
          assert.equal(child.permissionLevel, "read_only");
          assert.equal(child.readOnlyCeiling, true);
          assert.equal(child.workspaceScope?.readonly, true);
          assert.equal(
            child.orchestrationPolicy?.parentCancellation,
            "attached",
          );
          assert.equal(child.orchestrationPolicy?.completionReporting, "none");
        }
        if (cancelled)
          await runtime.services.workbenchRun.abortAgent(parent.id);
        for (const child of children) {
          const childRunId = await eventually(
            async () =>
              (
                await runtime.services.workbenchRun.getAgentHistory(child.id)
              ).find((entry) => entry.runId)?.runId,
          );
          legitimateRunIds.add(childRunId);
          const completion =
            await runtime.services.workbenchRun.waitForRun(childRunId);
          assert.equal(
            completion.run.status,
            cancelled ? "cancelled" : "completed",
          );
          const run =
            await runtime.services.workbenchRun.loadRunState(childRunId);
          assert.ok(run);
          assert.equal(run.run.agentId, child.id);
          assert.equal(run.run.status, cancelled ? "cancelled" : "completed");
          assert.ok(run.run.initialInputId);
          assert.equal(
            (
              await storage.canonicalStore.findRunByInitialInputId(
                child.id,
                run.run.initialInputId,
              )
            )?.runId,
            run.run.runId,
          );
          const inputs = await storage.canonicalStore.readDocument<{
            inputs: {
              id: string;
              state: string;
              delivery?: { runId: string };
            }[];
          }>("agent_inputs", "global", child.id);
          assert.equal(
            inputs?.data.inputs.length,
            1,
            "one durable assignment acceptance",
          );
          assert.equal(inputs?.data.inputs[0]?.id, run.run.initialInputId);
          assert.equal(inputs?.data.inputs[0]?.delivery?.runId, childRunId);
          assert.equal(inputs?.data.inputs[0]?.state, "delivered");
          // Metadata for this conversation only: the invariant is one accepted assignment/run per child.
          const journal = new ConversationJournalRepository(storage);
          try {
            const state = await journal.load(conversation.id);
            assert.equal(
              [...state.runProjections.values()].filter(
                (candidate) => candidate.run.agentId === child.id,
              ).length,
              1,
            );
          } finally {
            await journal.close();
          }
        }
        await eventually(async () => {
          const state =
            await runtime.services.workbenchRun.loadRunState(parentRunId);
          if (state && ["failed", "interrupted"].includes(state.run.status))
            assert.fail(JSON.stringify(state.run));
          return state?.run.status === (cancelled ? "cancelled" : "completed")
            ? state
            : undefined;
        });
        for (const runId of hydratedIds)
          assert.ok(
            legitimateRunIds.has(runId),
            `Only exact submitted parent/child runs may be hydrated: ${runId}`,
          );
        assert.deepEqual(
          historicalEnumerations,
          [],
          "real execution/reporting must not enumerate historical runs",
        );
        if (!cancelled) {
          for (const child of children)
            assert.ok(
              parentReportPayload.includes(child.id),
              "report preserves the actual child identity",
            );
          for (const task of tasks)
            assert.ok(
              parentReportPayload.includes(`REPORT_${task.task}`),
              `parent must receive the exact report for ${task.task}`,
            );
        }
      }
      assert.equal(
        legitimateRunIds.size,
        8,
        "one parent and three children per completed/cancelled assignment",
      );
      assert.deepEqual(
        historicalEnumerations,
        [],
        "no historical/global metadata enumeration after bootstrap",
      );
      assert.ok(hydratedIds.size > 0, "real full-state boundary was exercised");
      for (const runId of hydratedIds) {
        assert.ok(
          legitimateRunIds.has(runId),
          `Only exact submitted parent/child runs may be hydrated: ${runId}`,
        );
      }
    } finally {
      t.mock.restoreAll();
      await shutdownServerRuntime(runtime.runtime);
      parentRegistration.unregister();
      childRegistration.unregister();
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });
}

// The real auth/preparation fence from held-auth-configuration.integration:
// durable acceptance/admission is not proof that an LLM request was dispatched.
test("accepted named submission can fail preparation with zero provider calls and retain its prompt", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-submission-predispatch-"));
  const providerId = "nerve-history-predispatch";
  const provider = registerAgentScriptedProvider({
    provider: providerId,
    steps: [],
  });
  let requests = 0;
  provider.setResponses([
    () => {
      requests++;
      return fauxAssistantMessage("must not dispatch");
    },
  ]);
  const storage = await initializeStorage(home);
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  let entered!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalAuth = runtime.runtime.auth.requestAuthForPiModel.bind(
    runtime.runtime.auth,
  );
  runtime.runtime.auth.requestAuthForPiModel = async (model) => {
    if (model.provider === providerId) {
      entered();
      await gate;
    }
    return originalAuth(model);
  };
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: home,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const agent = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: providerId, modelId: "scripted-fast" },
      tools: [],
    });
    const submission = runtime.services.workbenchRun.submitAgentRun(
      agent.id,
      "ACCEPTED_BEFORE_PREPARATION",
      undefined,
      { idempotencyKey: "predispatch-assignment" },
    );
    await held;
    const accepted = await storage.canonicalStore.readDocument<{
      inputs: { id: string; state: string; text: string }[];
    }>("agent_inputs", "global", agent.id);
    assert.equal(accepted?.data.inputs.length, 1);
    assert.equal(accepted?.data.inputs[0]?.state, "delivered");
    assert.equal(accepted?.data.inputs[0]?.text, "ACCEPTED_BEFORE_PREPARATION");
    await runtime.services.agentLifecycle.configureAgent(agent.id, {
      model: { provider: providerId, modelId: "missing-model" },
    });
    release();
    const identity = await submission;
    const state = await runtime.services.workbenchRun.waitForRun(
      identity.runId,
    );
    assert.equal(state.run.status, "failed");
    assert.equal(state.run.failure?.code, "AGENT_CONFIGURATION_BLOCKED");
    assert.equal(state.run.initialInputId, accepted?.data.inputs[0]?.id);
    assert.equal(requests, 0);
    const retainedInput = await storage.canonicalStore.readDocument<{
      inputs: { id: string; state: string; delivery?: unknown }[];
    }>("agent_inputs", "global", agent.id);
    assert.equal(retainedInput?.data.inputs.length, 1);
    assert.equal(retainedInput?.data.inputs[0]?.state, "delivered");
    assert.ok(retainedInput?.data.inputs[0]?.delivery);
    // Retrying acceptance binds the original terminal admission, never an empty
    // second execution or a silent drop/replay of the accepted prompt.
    const retried = await runtime.services.workbenchRun.submitAgentRun(
      agent.id,
      "ACCEPTED_BEFORE_PREPARATION",
      undefined,
      { idempotencyKey: "predispatch-assignment" },
    );
    assert.deepEqual(retried, identity);
    assert.equal(requests, 0);
  } finally {
    release();
    await shutdownServerRuntime(runtime.runtime);
    provider.unregister();
    await rm(home, { recursive: true, force: true });
  }
});
