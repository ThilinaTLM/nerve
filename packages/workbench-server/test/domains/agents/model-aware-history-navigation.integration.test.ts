import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import {
  decode,
  encode,
} from "../../../src/infrastructure/persistence/canonical-sqlite/payload-codecs.js";
import type { SerializedConversationState } from "../../../src/domains/conversations/conversation-state-materializer.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";
import { ModelHistoryInvalidError } from "../../../src/domains/conversations/model-history-navigation.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import type { RunHydratedState } from "../../../src/domains/runs/runtime/run-unit-of-work.js";

function executionEvidence(state: RunHydratedState | undefined) {
  assert.ok(state);
  // Delivery acknowledgements can finish after settlement; execution authority cannot.
  return {
    run: state.run,
    checkpoints: state.checkpoints,
    interactions: state.interactions,
    transitions: state.transitions,
    prompts: state.prompts,
  };
}

/** Corrupt only a closed disposable fixture to simulate an old invalid selection.
 * The new journal write guard must never be bypassed in production or live data.
 */
function seedHistoricalStatusLeaf(
  path: string,
  conversationId: string,
  statusId: string,
  ownerAgentId?: string,
) {
  const database = new DatabaseSync(path);
  try {
    const row = database
      .prepare(
        "SELECT data FROM domain_documents WHERE namespace = 'conversation_state' AND scope_id = ? AND document_id = 'state'",
      )
      .get(conversationId) as { data: Uint8Array } | undefined;
    assert.ok(row);
    const state = decode(row.data) as SerializedConversationState;
    assert.ok(state.entries.some((entry) => entry.id === statusId));
    const entries = ownerAgentId
      ? (new Map(state.agentModelEntries).get(ownerAgentId) ?? [])
      : state.modelEntries;
    assert.ok(!entries.some((entry) => entry.id === statusId));
    if (ownerAgentId) {
      const leaves = new Map(state.agentModelLeafIds);
      leaves.set(ownerAgentId, statusId);
      state.agentModelLeafIds = [...leaves];
    } else {
      state.modelLeafId = statusId;
      assert.ok(state.conversation);
      state.conversation.activeEntryId = statusId;
    }
    database
      .prepare(
        "UPDATE domain_documents SET data = ? WHERE namespace = 'conversation_state' AND scope_id = ? AND document_id = 'state'",
      )
      .run(encode(state), conversationId);
    if (ownerAgentId) return;
    const metadata = database
      .prepare(
        "SELECT scope_id, document_id, data FROM domain_documents WHERE namespace = 'conversation'",
      )
      .all() as { scope_id: string; document_id: string; data: Uint8Array }[];
    const document = metadata.find(
      (item) => item.document_id === conversationId,
    );
    assert.ok(document);
    const conversation = decode(document.data) as { activeEntryId?: string };
    conversation.activeEntryId = statusId;
    database
      .prepare(
        "UPDATE domain_documents SET data = ? WHERE namespace = 'conversation' AND scope_id = ? AND document_id = ?",
      )
      .run(encode(conversation), document.scope_id, document.document_id);
  } finally {
    database.close();
  }
}

for (const inline of [false, true]) {
  test(`persisted status leaf blocks common ${inline ? "inline shell" : "provider"} preparation without repair or prompt loss`, async () => {
    const home = await mkdtemp(
      join(tmpdir(), "nerve-model-history-navigation-"),
    );
    const output = join(home, "MUST_NOT_EXECUTE_INVALID_CONTEXT");
    const prompt = inline
      ? `!touch '${output}'`
      : "UNDISPATCHED_INVALID_CONTEXT";
    const providerId = inline
      ? "nerve-invalid-history-inline"
      : "nerve-invalid-history-model";
    const provider = registerAgentScriptedProvider({
      provider: providerId,
      steps: [],
    });
    let requests = 0;

    let storage = await initializeStorage(home);
    let runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
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
      });
      provider.setResponses(
        Array.from({ length: 5 }, () => () => {
          requests++;
          return fauxAssistantMessage("ORIGINAL_MODEL_REPORT");
        }),
      );
      const checkpointIdentity =
        await runtime.services.workbenchRun.submitAgentRun(
          agent.id,
          "ORIGINAL_MODEL_BRANCH",
          undefined,
          { idempotencyKey: "original-checkpoint" },
        );
      const checkpointEvidence = await runtime.services.workbenchRun.waitForRun(
        checkpointIdentity.runId,
        AbortSignal.timeout(15_000),
      );
      assert.equal(checkpointEvidence.run.status, "completed");
      assert.ok(checkpointEvidence.checkpoints.length > 0);
      await runtime.services.agentLifecycle.configureAgent(agent.id, {
        model: { provider: providerId, modelId: "missing-model" },
      });
      const original = await runtime.services.workbenchRun.submitAgentRun(
        agent.id,
        "PREVIOUS_PREPARATION_FAILURE",
        undefined,
        { idempotencyKey: "original-failure" },
      );
      const failed = await runtime.services.workbenchRun.waitForRun(
        original.runId,
        AbortSignal.timeout(15_000),
      );
      assert.equal(failed.run.status, "failed");
      assert.equal(requests, 1);
      await runtime.services.agentLifecycle.configureAgent(agent.id, {
        model: { provider: providerId, modelId: "scripted-fast" },
      });
      const state = await runtime.services.conversationJournal.load(
        conversation.id,
      );
      const status = state.entries.find(
        (entry) =>
          entry.kind === "run_status" && entry.runId === original.runId,
      );
      assert.ok(status);
      const validLeaf = state.modelLeafId;
      assert.ok(validLeaf);
      const originalEvidence = structuredClone(executionEvidence(failed));
      await shutdownServerRuntime(runtime.runtime);
      seedHistoricalStatusLeaf(
        storage.paths.sqlitePath,
        conversation.id,
        status.id,
      );
      storage = await initializeStorage(home);
      runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
      await runtime.lifecycle.hydrate();
      const malformed = await runtime.services.conversationJournal.load(
        conversation.id,
      );
      assert.equal(malformed.modelLeafId, status.id);
      await assert.rejects(
        runtime.services.subagentTranscripts.snapshot(agent.id),
        ModelHistoryInvalidError,
      );
      const identity = await runtime.services.workbenchRun.submitAgentRun(
        agent.id,
        prompt,
        undefined,
        { idempotencyKey: "invalid-context-assignment" },
      );
      const blocked = await runtime.services.workbenchRun.waitForRun(
        identity.runId,
        AbortSignal.timeout(15_000),
      );
      assert.equal(blocked.run.status, "failed");
      assert.equal(blocked.run.failure?.code, "MODEL_HISTORY_INVALID");
      assert.equal(blocked.run.failure?.retryable, false);
      assert.equal(blocked.run.failure?.continuable, false);
      assert.equal(
        requests,
        1,
        "invalid context must make zero further provider requests",
      );
      const accepted = (
        await new AgentInputRepository(storage).load(agent.id)
      )?.inputs.find((input) => input.id === blocked.run.initialInputId);
      assert.ok(accepted);
      assert.equal(accepted.state, "pending");
      assert.equal(accepted.text, prompt);
      assert.equal(accepted.delivery, undefined);
      assert.equal(
        (await runtime.services.conversationJournal.load(conversation.id))
          .modelLeafId,
        status.id,
        "no automatic leaf repair",
      );
      assert.deepEqual(
        executionEvidence(
          await runtime.services.workbenchRun.loadRunState(original.runId),
        ),
        originalEvidence,
        "failed execution evidence stays untouched",
      );
      assert.deepEqual(
        executionEvidence(
          await runtime.services.workbenchRun.loadRunState(
            checkpointIdentity.runId,
          ),
        ),
        executionEvidence(checkpointEvidence),
        "prior checkpoint evidence stays untouched",
      );
      await assert.rejects(access(output), { code: "ENOENT" });
      assert.equal(
        blocked.transitions
          .flatMap((transition) => transition.entries)
          .filter((entry) =>
            entry.text.includes("MUST_NOT_EXECUTE_INVALID_CONTEXT"),
          ).length,
        0,
        "inline command does not execute or consume input",
      );

      const beforeRejectedSummary =
        await runtime.services.conversationJournal.load(conversation.id);
      const selectionBeforeSummary =
        beforeRejectedSummary.conversation?.activeEntryId;
      const summariesBefore = beforeRejectedSummary.entries.filter(
        (entry) => entry.kind === "branch_summary",
      );
      const entriesBeforeSummary = structuredClone(
        beforeRejectedSummary.modelEntries,
      );
      await assert.rejects(
        runtime.services.navigationService.navigateConversation(
          conversation.id,
          { activeEntryId: validLeaf, summarize: true },
        ),
        ModelHistoryInvalidError,
      );
      const afterRejectedSummary =
        await runtime.services.conversationJournal.load(conversation.id);
      assert.equal(
        afterRejectedSummary.conversation?.activeEntryId,
        selectionBeforeSummary,
      );
      assert.deepEqual(
        afterRejectedSummary.entries.filter(
          (entry) => entry.kind === "branch_summary",
        ),
        summariesBefore,
      );
      assert.equal(afterRejectedSummary.modelLeafId, status.id);
      assert.deepEqual(afterRejectedSummary.modelEntries, entriesBeforeSummary);
      // Ordinary explicit navigation is the only repair authority. The target is
      // an actual model entry, not the transcript's nearest status ancestor.
      await runtime.services.navigationService.navigateConversation(
        conversation.id,
        { activeEntryId: validLeaf, summarize: false },
      );
      assert.equal(
        (await runtime.services.conversationJournal.load(conversation.id))
          .modelLeafId,
        validLeaf,
      );
      assert.equal(
        (await runtime.services.subagentTranscripts.snapshot(agent.id))
          .activeEntryId,
        validLeaf,
      );
      assert.equal(requests, 1, "navigation must not replay accepted input");
      assert.deepEqual(
        executionEvidence(
          await runtime.services.workbenchRun.loadRunState(original.runId),
        ),
        originalEvidence,
      );
      const blockedEvidence = executionEvidence(
        await runtime.services.workbenchRun.loadRunState(identity.runId),
      );
      await shutdownServerRuntime(runtime.runtime);
      storage = await initializeStorage(home);
      runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
      await runtime.lifecycle.hydrate();
      assert.equal(
        (await runtime.services.conversationJournal.load(conversation.id))
          .modelLeafId,
        validLeaf,
      );
      assert.deepEqual(
        executionEvidence(
          await runtime.services.workbenchRun.loadRunState(original.runId),
        ),
        originalEvidence,
      );
      assert.deepEqual(
        executionEvidence(
          await runtime.services.workbenchRun.loadRunState(identity.runId),
        ),
        blockedEvidence,
      );
      assert.deepEqual(
        executionEvidence(
          await runtime.services.workbenchRun.loadRunState(
            checkpointIdentity.runId,
          ),
        ),
        executionEvidence(checkpointEvidence),
      );
      assert.equal(
        (await new AgentInputRepository(storage).load(agent.id))?.inputs.find(
          (input) => input.id === accepted.id,
        )?.state,
        "pending",
      );
      await assert.rejects(access(output), { code: "ENOENT" });
      assert.equal(requests, 1);
    } finally {
      await shutdownServerRuntime(runtime.runtime);
      provider.unregister();
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    }
  });
}

test("isolated child integrity is independent of a valid shared owner and never falls back to parent history", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-model-owner-integrity-"));
  const providerId = "nerve-model-owner-integrity";
  const provider = registerAgentScriptedProvider({
    provider: providerId,
    steps: [],
  });
  let requests = 0;
  provider.setResponses(
    Array.from({ length: 5 }, () => (context) => {
      requests++;
      assert.doesNotMatch(
        JSON.stringify(context.messages),
        /UNDISPATCHED_CHILD_ASSIGNMENT/,
      );
      return fauxAssistantMessage("VALID_SHARED_OWNER_REPORT");
    }),
  );
  let storage = await initializeStorage(home);
  let runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: home,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const parent = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: providerId, modelId: "scripted-fast" },
    });
    const first = await runtime.services.workbenchRun.submitAgentRun(
      parent.id,
      "VALID_PARENT_ASSIGNMENT",
    );
    await runtime.services.workbenchRun.waitForRun(
      first.runId,
      AbortSignal.timeout(15_000),
    );
    const child = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      parentAgentId: parent.id,
      model: { provider: providerId, modelId: "scripted-fast" },
      permissionLevel: "read_only",
      readOnlyCeiling: true,
      orchestrationPolicy: {
        preset: "explore",
        parentCancellation: "attached",
        completionReporting: "none",
      },
    });
    assert.equal(child.contextOwnerAgentId, child.id);
    await runtime.services.conversationLifecycle.appendEntry({
      conversationId: conversation.id,
      agentId: parent.id,
      runId: first.runId,
      role: "system",
      kind: "run_status",
      text: "Fixture transcript-only historical status",
    });
    const state = await runtime.services.conversationJournal.load(
      conversation.id,
    );
    const status = state.entries.find(
      (entry) => entry.kind === "run_status" && entry.runId === first.runId,
    );
    assert.ok(status);
    const sharedLeaf = state.modelLeafId;
    await shutdownServerRuntime(runtime.runtime);
    seedHistoricalStatusLeaf(
      storage.paths.sqlitePath,
      conversation.id,
      status.id,
      child.id,
    );
    storage = await initializeStorage(home);
    runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
    await runtime.lifecycle.hydrate();
    assert.equal(
      (await runtime.services.subagentTranscripts.snapshot(parent.id))
        .activeEntryId,
      sharedLeaf,
    );
    await assert.rejects(
      runtime.services.subagentTranscripts.snapshot(child.id),
      ModelHistoryInvalidError,
    );
    const submission = await runtime.services.workbenchRun.submitAgentRun(
      child.id,
      "UNDISPATCHED_CHILD_ASSIGNMENT",
      { agentId: parent.id },
    );
    const blocked = await runtime.services.workbenchRun.waitForRun(
      submission.runId,
      AbortSignal.timeout(15_000),
    );
    assert.equal(blocked.run.failure?.code, "MODEL_HISTORY_INVALID");
    assert.equal(requests, 1);
    const queued = (
      await new AgentInputRepository(storage).load(child.id)
    )?.inputs.find((input) => input.id === blocked.run.initialInputId);
    assert.equal(queued?.state, "pending");
    assert.equal(queued?.delivery, undefined);
    const after = await runtime.services.conversationJournal.load(
      conversation.id,
    );
    assert.equal(after.modelLeafId, sharedLeaf);
    assert.equal(after.agentModelLeafIds.get(child.id), status.id);
    const parentContinued = await runtime.services.workbenchRun.submitAgentRun(
      parent.id,
      "VALID_PARENT_NEXT_ASSIGNMENT",
    );
    assert.equal(
      (
        await runtime.services.workbenchRun.waitForRun(
          parentContinued.runId,
          AbortSignal.timeout(15_000),
        )
      ).run.status,
      "completed",
    );
    assert.equal(
      requests,
      2,
      "valid owner remains executable without repairing the child",
    );
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    provider.unregister();
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  }
});

test("reopened initialization and cache rebuild preserve usable valid conversations beside readable invalid history", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-mixed-history-reopen-"));
  const providerId = "nerve-mixed-history-reopen";
  const provider = registerAgentScriptedProvider({
    provider: providerId,
    steps: [],
  });
  let requests = 0;
  provider.setResponses(
    Array.from({ length: 5 }, () => () => {
      requests++;
      return fauxAssistantMessage("VALID_CONVERSATION_REPORT");
    }),
  );
  let storage = await initializeStorage(home);
  let runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: home,
    });
    const valid =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const invalid =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const createAgent = (conversationId: string) =>
      runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId,
        model: { provider: providerId, modelId: "scripted-fast" },
      });
    const validAgent = await createAgent(valid.id);
    const invalidAgent = await createAgent(invalid.id);
    const initial = await runtime.services.workbenchRun.submitAgentRun(
      validAgent.id,
      "VALID_CONTEXT_BEFORE_REOPEN",
    );
    await runtime.services.workbenchRun.waitForRun(
      initial.runId,
      AbortSignal.timeout(15_000),
    );
    const status = await runtime.services.conversationLifecycle.appendEntry({
      conversationId: invalid.id,
      agentId: invalidAgent.id,
      role: "system",
      kind: "run_status",
      text: "Fixture dangling historical status",
    });
    await shutdownServerRuntime(runtime.runtime);
    seedHistoricalStatusLeaf(storage.paths.sqlitePath, invalid.id, status.id);
    storage = await initializeStorage(home);
    runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
    await runtime.lifecycle.hydrate();
    const snapshot =
      await runtime.services.conversationQuery.getConversationSnapshot(
        invalid.id,
      );
    assert.ok(snapshot.entries.some((entry) => entry.id === status.id));
    assert.equal(snapshot.tree.navigation.contextState, "invalid");
    await assert.rejects(
      runtime.services.subagentTranscripts.snapshot(invalidAgent.id),
      ModelHistoryInvalidError,
    );
    const cache = runtime.services.conversationService;
    cache.setForAgent(invalidAgent.id, [
      { role: "user", content: "STALE_CONTEXT", timestamp: 0 },
    ]);
    const validRecord = runtime.services.conversationLifecycle.getConversation(
      valid.id,
    );
    const invalidRecord =
      runtime.services.conversationLifecycle.getConversation(invalid.id);
    await cache.rebuildAll(
      [project],
      [validRecord, invalidRecord],
      [validAgent, invalidAgent],
      new Map([
        [
          valid.id,
          (await runtime.services.conversationJournal.load(valid.id)).entries,
        ],
        [
          invalid.id,
          (await runtime.services.conversationJournal.load(invalid.id)).entries,
        ],
      ]),
    );
    assert.ok(cache.getForAgent(validAgent.id)?.length);
    assert.equal(cache.getForAgent(invalidAgent.id), undefined);
    assert.equal(
      requests,
      1,
      "cache rebuild never dispatches or repairs invalid history",
    );
    assert.equal(
      (await runtime.services.conversationJournal.load(invalid.id)).modelLeafId,
      status.id,
    );
    const next = await runtime.services.workbenchRun.submitAgentRun(
      validAgent.id,
      "VALID_CONTEXT_AFTER_REOPEN",
    );
    assert.equal(
      (
        await runtime.services.workbenchRun.waitForRun(
          next.runId,
          AbortSignal.timeout(15_000),
        )
      ).run.status,
      "completed",
    );
    assert.equal(requests, 2);
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    provider.unregister();
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  }
});
