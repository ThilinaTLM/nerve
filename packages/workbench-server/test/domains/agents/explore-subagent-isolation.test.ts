import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import {
  conversationStream,
  type NotifyEvent,
} from "@nervekit/contracts/events";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import {
  initializeStorage,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { WorkbenchRunUnitOfWork } from "../../../src/domains/runs/persistence/run-transition.repository.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";

describe("explore subagent transcript isolation", () => {
  it("keeps child harness messages and tools out of the parent conversation", async () => {
    const provider = "nerve-scripted-explore-isolation";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "explore_ls_1",
          name: "ls",
          args: { path: "." },
        },
        {
          type: "assistantText",
          text: "The temporary project is isolated and readable.",
        },
        {
          type: "assistantText",
          text: "The child accepted a direct follow-up.",
        },
      ],
    });
    const parentProvider = "nerve-scripted-explore-isolation-parent";
    const parentRegistration = registerAgentScriptedProvider({
      provider: parentProvider,
      steps: [
        {
          type: "assistantText",
          text: "Parent acknowledged the direct child intervention.",
        },
      ],
    });
    const root = await mkdtemp(join(tmpdir(), "nerve-explore-isolation-"));
    const storage = await initializeStorage(root);
    const orchestrator = createRuntimeFixture(storage, "127.0.0.1", 0);
    const liveEvents: NotifyEvent[] = [];
    const unsubscribe = orchestrator.runtime.events.subscribeNotify((event) => {
      if (event.type.startsWith("conversation.live.")) liveEvents.push(event);
    });
    try {
      await orchestrator.lifecycle.hydrate();
      const project =
        await orchestrator.services.projectLifecycle.createProject({
          dir: root,
        });
      const conversation =
        await orchestrator.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const parent = await orchestrator.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider, modelId: "scripted-fast" },
      });
      const result = await orchestrator.services.tools.requestTool(
        orchestrator.services.agentLifecycle.getAgent(parent.id),
        "explore",
        {
          tasks: [
            {
              task: "Inspect the temporary project and summarize its contents.",
              label: "Temporary  project contents",
              context:
                "Verify that relative ls paths start from the project root.",
            },
          ],
          context:
            "The parent read a plan under /tmp/.nerve-v2/plans/example.md and needs a focused read-only verification of the actual source project.",
        },
      );

      assert.equal(result.toolCall.status, "completed");
      assert.match(
        JSON.stringify(result.toolCall.result),
        /temporary project is isolated/i,
      );

      const child = orchestrator.services.agentLifecycle
        .listAgents()
        .find((agent) => agent.parentAgentId === parent.id);
      assert.ok(child);
      assert.equal(child.orchestrationPolicy?.preset, "explore");
      assert.equal(child.orchestrationPolicy?.completionReporting, "none");
      assert.equal(child.readOnlyCeiling, true);
      assert.equal(child.name, "Temporary project contents");
      assert.deepEqual(child.model, parent.model);
      assert.equal(
        orchestrator.services.subagentTranscriptLive.snapshot(child.id),
        undefined,
      );
      assert.ok((child.systemPrompt ?? "").includes(project.dir));
      assert.match(
        child.systemPrompt ?? "",
        /NERVE_HOME.*artifacts, not the source root/,
      );
      assert.equal(
        orchestrator.services.conversationLifecycle.getConversation(
          conversation.id,
        ).activeAgentId,
        parent.id,
      );

      const snapshot =
        await orchestrator.services.conversationQuery.getConversationSnapshot(
          conversation.id,
        );
      assert.deepEqual(snapshot.entries, []);
      assert.deepEqual(snapshot.activeEntryIds, []);
      const childHarness = JSON.stringify(
        (
          await new ConversationJournalRepository(storage).load(conversation.id)
        ).agentModelEntries.get(child.id) ?? [],
      );
      assert.match(childHarness, /focused read-only verification/);
      assert.match(childHarness, /Task-specific context/);
      assert.match(
        childHarness,
        /relative ls paths start from the project root/,
      );
      assert.match(childHarness, /temporary project is isolated/i);

      const childToolCalls =
        await orchestrator.services.tools.listToolCallPreviews({
          agentId: child.id,
          limit: 10,
        });
      assert.equal(childToolCalls.length, 1);
      assert.equal(childToolCalls[0]?.toolName, "ls");
      assert.equal(childToolCalls[0]?.status, "completed");
      assert.equal(childToolCalls[0]?.hidden, true);
      const childTranscript =
        await orchestrator.services.subagentTranscripts.get(
          parent.id,
          child.id,
        );
      assert.equal(childTranscript.parentAgentId, parent.id);
      assert.equal(childTranscript.agentId, child.id);
      assert.match(
        childTranscript.entries.map((entry) => entry.text).join("\n"),
        /focused read-only verification|temporary project is isolated/i,
      );
      assert.equal(childTranscript.toolCalls.length, 1);
      assert.equal(childTranscript.toolCalls[0]?.toolName, "ls");
      assert.equal(childTranscript.toolCalls[0]?.hidden, true);
      assert.equal(childTranscript.entriesTruncated, false);
      assert.equal(childTranscript.conversationId, conversation.id);
      assert.equal(childTranscript.projectId, project.id);
      assert.equal(childTranscript.activeRun, undefined);
      assert.ok(childTranscript.cursorSeq > 0);

      // Exercise recovery as well as admission: no assignment correlation may
      // reconstruct a duplicate report/notification after the wrapper returns.
      await orchestrator.services.asyncObligationRuntime.stop();
      await orchestrator.services.asyncObligationRuntime.start();
      const parentReports =
        await orchestrator.services.tools.listToolCallPreviews({
          agentId: parent.id,
          limit: 10,
        });
      assert.deepEqual(
        parentReports.map((call) => [call.id, call.toolName, call.status]),
        [[result.toolCall.id, "explore", "completed"]],
      );
      assert.deepEqual(
        await storage.canonicalStore.listDocuments(
          "async-subagent-assignment",
          parent.id,
        ),
        [],
      );
      const parentInputs = await storage.canonicalStore.readDocument<{
        inputs: unknown[];
      }>("agent_inputs", "global", parent.id);
      assert.deepEqual(parentInputs?.data.inputs ?? [], []);
      assert.equal(
        (await new WorkbenchRunUnitOfWork(storage.paths.home, 0).list()).some(
          (state) => state.run.agentId === parent.id,
        ),
        false,
        "returning an Explore tool report must not admit the idle parent",
      );
      const stream = await orchestrator.runtime.events.readStream(
        conversationStream(conversation.id),
        1,
        1_000,
      );
      const childRuns = (
        await new WorkbenchRunUnitOfWork(storage.paths.home, 0).list()
      ).filter((state) => state.run.agentId === child.id);
      assert.equal(childRuns.length, 1);
      assert.equal(
        childRuns[0]?.run.status,
        "completed",
        JSON.stringify(childRuns[0]?.run),
      );
      const childRunId = childRuns[0]!.run.runId;
      const childLifecycle = stream.events.filter(
        (event) =>
          (event.data as { agentId?: string; runId?: string }).agentId ===
            child.id &&
          (event.data as { runId?: string }).runId === childRunId &&
          (event.type === "run.started" || event.type === "run.completed"),
      );
      assert.deepEqual(
        childLifecycle.map((event) => event.type),
        ["run.started", "run.completed"],
      );
      const childLive = liveEvents.filter(
        (event) => (event.data as { agentId?: string }).agentId === child.id,
      );
      assert.ok(
        childLive.some(
          (event) => event.type === "conversation.live.turn.started",
        ),
      );
      const deltas = childLive.filter(
        (event) => event.type === "conversation.live.content.delta",
      );
      assert.ok(
        deltas.length > 0,
        "common child runtime must publish live content deltas",
      );
      assert.match(JSON.stringify(deltas), /temporary project is isolated/i);
      assert.ok(
        childLive.every(
          (event) =>
            (event.data as { conversationId?: string; runId?: string })
              .conversationId === conversation.id &&
            (event.data as { runId?: string }).runId === childRunId,
        ),
        "live child events retain exact agent/conversation/run routing",
      );
      assert.equal(
        liveEvents.some(
          (event) =>
            event.type === "conversation.live.content.delta" &&
            (event.data as { agentId?: string }).agentId === parent.id,
        ),
        false,
        "the wrapper must not create a parent run or borrow child live content",
      );
      await assert.rejects(
        orchestrator.services.subagentTranscripts.get(child.id, parent.id),
        hasErrorCode("SUBAGENT_TRANSCRIPT_NOT_FOUND"),
      );
      assert.equal(
        snapshot.toolCalls.some((toolCall) => toolCall.agentId === child.id),
        false,
      );
      // Direct user controls intentionally notify the parent. Give its response
      // a separate script so that notice cannot consume the child's follow-up.
      await orchestrator.services.agentLifecycle.configureAgent(parent.id, {
        model: { provider: parentProvider, modelId: "scripted-fast" },
      });
      await orchestrator.services.agentLifecycle.configureAgent(child.id, {
        mode: "planning",
      });
      assert.equal(
        orchestrator.services.agentLifecycle.getAgent(child.id).mode,
        "planning",
      );
      await assert.rejects(
        orchestrator.services.agentLifecycle.configureAgent(child.id, {
          permissionLevel: "autonomous",
        }),
      );
      assert.equal(
        orchestrator.services.agentLifecycle.getAgent(child.id).readOnlyCeiling,
        true,
      );
      await orchestrator.services.workbenchRun.promptAgent(child.id, {
        text: "Continue.",
      });
      const deadline = Date.now() + 5_000;
      while (true) {
        const childEntries =
          (
            await new ConversationJournalRepository(storage).load(
              conversation.id,
            )
          ).agentModelEntries.get(child.id) ?? [];
        if (
          JSON.stringify(childEntries).includes(
            "The child accepted a direct follow-up.",
          )
        )
          break;
        assert.ok(
          Date.now() < deadline,
          `child direct follow-up must reach its own context: ${JSON.stringify((await new WorkbenchRunUnitOfWork(storage.paths.home, 0).list()).map((state) => state.run))}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await orchestrator.services.asyncObligationRuntime.stop();
      await orchestrator.services.asyncObligationRuntime.start();
      const runStatesAfterFollowUp = await new WorkbenchRunUnitOfWork(
        storage.paths.home,
        0,
      ).list();
      assert.equal(
        runStatesAfterFollowUp.filter((state) => state.run.agentId === child.id)
          .length,
        2,
      );
      // Any later parent admission belongs to deliberate user intervention,
      // never a duplicate child completion report.
      const parentInputState = await storage.canonicalStore.readDocument<{
        inputs: { origin: { producer?: string; correlationId?: string } }[];
      }>("agent_inputs", "global", parent.id);
      assert.ok(
        (parentInputState?.data.inputs ?? []).every(
          (input) =>
            input.origin.producer === "async_obligation" &&
            input.origin.correlationId?.startsWith("user_intervention:"),
        ),
      );
      assert.ok((parentInputState?.data.inputs.length ?? 0) > 0);
      assert.deepEqual(
        await storage.canonicalStore.listDocuments(
          "async-subagent-assignment",
          parent.id,
        ),
        [],
      );
      for (const run of runStatesAfterFollowUp.filter(
        (state) => state.run.agentId === child.id,
      )) {
        assert.equal(
          await storage.canonicalStore.readAgentObligation(
            `async_subagent:${run.run.runId}:0`,
          ),
          undefined,
        );
      }
      const parentAfterFollowUp =
        await orchestrator.services.conversationQuery.getConversationSnapshot(
          conversation.id,
        );
      assert.doesNotMatch(
        JSON.stringify(parentAfterFollowUp.entries),
        /temporary project is isolated|child accepted a direct follow-up/i,
      );
      assert.equal(
        orchestrator.services.conversationLifecycle.getConversation(
          conversation.id,
        ).activeAgentId,
        parent.id,
      );
    } finally {
      unsubscribe();
      parentRegistration.unregister();
      registration.unregister();
      await shutdownServerRuntime(orchestrator.runtime);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });

  it("hydrates a legacy Explore without reporting policy and keeps future follow-up completion child-owned", async () => {
    const childProvider = "nerve-scripted-legacy-explore-followup";
    const parentProvider = "nerve-scripted-legacy-explore-parent";
    const registrations = [
      registerAgentScriptedProvider({
        provider: childProvider,
        steps: [
          {
            type: "assistantText",
            text: "Legacy child direct follow-up response.",
          },
        ],
      }),
      registerAgentScriptedProvider({
        provider: parentProvider,
        steps: [
          {
            type: "assistantText",
            text: "Parent acknowledged deliberate intervention.",
          },
        ],
      }),
    ];
    const home = await mkdtemp(
      join(tmpdir(), "nerve-legacy-explore-followup-"),
    );
    let storage = await initializeStorage(home);
    let fixture = createRuntimeFixture(storage, "127.0.0.1", 0);
    try {
      await fixture.lifecycle.hydrate();
      const project = await fixture.services.projectLifecycle.createProject({
        dir: home,
      });
      const conversation =
        await fixture.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const parent = await fixture.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: parentProvider, modelId: "scripted-fast" },
      });
      const child = await fixture.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent.id,
        model: { provider: childProvider, modelId: "scripted-fast" },
        permissionLevel: "read_only",
        readOnlyCeiling: true,
        orchestrationPolicy: {
          preset: "explore",
          parentCancellation: "attached",
          completionReporting: "none",
        },
      });
      const document = await storage.canonicalStore.readDocument(
        "agent",
        "global",
        child.id,
      );
      assert.ok(document);
      const legacy = { ...child, executionKind: "explore" as const };
      delete legacy.orchestrationPolicy;
      await storage.canonicalStore.writeDocument({
        namespace: "agent",
        scopeId: "global",
        documentId: child.id,
        expectedRevision: document.revision,
        data: legacy,
      });
      const journal = new ConversationJournalRepository(storage);
      const seedId = "entry_legacy_explore_seed";
      await journal.commit(conversation.id, {
        kind: "test.legacy_explore_context",
        events: [
          {
            kind: "model_context.entry_appended",
            conversationId: conversation.id,
            ownerAgentId: child.id,
            entry: {
              type: "message",
              id: seedId,
              parentId: null,
              timestamp: child.createdAt,
              message: {
                role: "user",
                content: "Historical child context",
                timestamp: Date.parse(child.createdAt),
              },
            },
          },
          {
            kind: "model_context.leaf_changed",
            conversationId: conversation.id,
            ownerAgentId: child.id,
            entryId: seedId,
          },
        ],
      });
      await journal.close();
      await shutdownServerRuntime(fixture.runtime);
      storage = await initializeStorage(home);
      fixture = createRuntimeFixture(storage, "127.0.0.1", 0);
      await fixture.lifecycle.hydrate();
      const decoded = fixture.services.agentLifecycle.getAgent(child.id);
      assert.equal(decoded.id, child.id);
      assert.equal(decoded.conversationId, conversation.id);
      assert.equal(decoded.contextOwnerAgentId, child.contextOwnerAgentId);
      assert.equal(decoded.orchestrationPolicy?.completionReporting, "none");
      assert.equal(decoded.orchestrationPolicy?.parentCancellation, "attached");
      await fixture.services.workbenchRun.promptAgent(child.id, {
        text: "Direct follow-up to legacy Explore",
      });
      await waitUntil(
        async () =>
          (await fixture.services.subagentTranscripts.snapshot(child.id))
            .latestCompletion?.outcome === "completed",
        async () =>
          JSON.stringify(
            (await new WorkbenchRunUnitOfWork(home, 0).list()).map(
              (state) => state.run,
            ),
          ),
      );
      await fixture.services.asyncObligationRuntime.stop();
      await fixture.services.asyncObligationRuntime.start();
      const history = await fixture.services.subagentTranscripts.snapshot(
        child.id,
      );
      assert.equal(
        history.latestCompletion?.response?.text,
        "Legacy child direct follow-up response.",
      );
      assert.ok(
        history.activeEntryIds.includes(seedId),
        "migration retains historical context IDs/ancestry",
      );
      assert.deepEqual(
        await storage.canonicalStore.listDocuments(
          "async-subagent-assignment",
          parent.id,
        ),
        [],
      );
      assert.equal(
        await storage.canonicalStore.readAgentObligation(
          `async_subagent:${history.latestCompletion!.runId}:0`,
        ),
        undefined,
      );
      const parentInputs = await storage.canonicalStore.readDocument<{
        inputs: { origin: { correlationId?: string } }[];
      }>("agent_inputs", "global", parent.id);
      assert.ok(
        (parentInputs?.data.inputs ?? []).every((input) =>
          input.origin.correlationId?.startsWith("user_intervention:"),
        ),
        "only intended direct-user intervention notices may reach parent",
      );
    } finally {
      await shutdownServerRuntime(fixture.runtime);
      for (const registration of registrations) registration.unregister();
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });
  it("repairs a persisted child active-agent reference during hydration", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-explore-recovery-"));
    const storage = await initializeStorage(root);
    const orchestrator = createRuntimeFixture(storage, "127.0.0.1", 0);
    let restarted: ReturnType<typeof createRuntimeFixture> | undefined;
    try {
      await orchestrator.lifecycle.hydrate();
      const project =
        await orchestrator.services.projectLifecycle.createProject({
          dir: root,
        });
      const conversation =
        await orchestrator.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const parent = await orchestrator.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });
      const child = await orchestrator.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent.id,
        task: "Recovery fixture",
      });
      assert.equal(
        orchestrator.services.conversationLifecycle.getConversation(
          conversation.id,
        ).activeAgentId,
        parent.id,
      );

      await shutdownServerRuntime(orchestrator.runtime);
      const journal = new ConversationJournalRepository(storage);
      const persistedBefore = (await journal.load(conversation.id))
        .conversation;
      assert.ok(persistedBefore);
      await journal.commit(conversation.id, {
        kind: "test.child_active_agent",
        events: [
          {
            kind: "conversation.upserted",
            conversationId: conversation.id,
            conversation: { ...persistedBefore, activeAgentId: child.id },
          },
        ],
      });

      const restartedStorage = await initializeStorage(root);
      restarted = createRuntimeFixture(restartedStorage, "127.0.0.1", 0);
      await restarted.lifecycle.hydrate();
      assert.equal(
        restarted.services.conversationLifecycle.getConversation(
          conversation.id,
        ).activeAgentId,
        parent.id,
      );
      const persisted = (
        await new ConversationJournalRepository(restartedStorage).load(
          conversation.id,
        )
      ).conversation;
      assert.equal(persisted?.activeAgentId, parent.id);
    } finally {
      await shutdownServerRuntime(orchestrator.runtime);
      if (restarted) await shutdownServerRuntime(restarted.runtime);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });

  it("cancels all parallel explore children with their parent run", async () => {
    const provider = "nerve-scripted-explore-cancellation";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "explore_cancel_parallel",
          name: "explore",
          args: {
            tasks: [
              { task: "Wait for cancellation", label: "first" },
              { task: "Also wait for cancellation", label: "second" },
            ],
            context: "Both children must remain active until Stop is used.",
            split_rationale:
              "These independent cancellation probes must run in parallel so Stop can be verified across every child.",
          },
        },
        { type: "waitForAbort" },
        { type: "waitForAbort" },
      ],
    });
    const root = await mkdtemp(join(tmpdir(), "nerve-explore-cancellation-"));
    const storage = await initializeStorage(root);
    await writeSettings(storage, {
      exploreAgent: {
        model: { provider, modelId: "scripted-fast" },
      },
    });
    const orchestrator = createRuntimeFixture(storage, "127.0.0.1", 0);
    try {
      await orchestrator.lifecycle.hydrate();
      const project =
        await orchestrator.services.projectLifecycle.createProject({
          dir: root,
        });
      const conversation =
        await orchestrator.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const parent = await orchestrator.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider, modelId: "scripted-fast" },
      });

      await orchestrator.services.workbenchRun.promptAgent(parent.id, {
        text: "Start both explore children.",
      });
      await waitUntil(
        async () => {
          const children = orchestrator.services.agentLifecycle
            .listAgents()
            .filter((agent) => agent.parentAgentId === parent.id);
          if (children.length !== 2) return false;
          const transcripts = await Promise.all(
            children.map((child) =>
              orchestrator.services.subagentTranscripts.get(
                parent.id,
                child.id,
              ),
            ),
          );
          return transcripts.every(
            (transcript) =>
              transcript.activeRun?.status === "running" &&
              transcript.activeRun.turns.length > 0,
          );
        },
        async () =>
          JSON.stringify(
            (
              await new WorkbenchRunUnitOfWork(storage.paths.home, 0).list()
            ).map((state) => state.run),
          ),
      );
      assert.equal(
        orchestrator.services.conversationLifecycle.getConversation(
          conversation.id,
        ).activeAgentId,
        parent.id,
      );
      await orchestrator.services.workbenchRun.abortAgent(parent.id);

      const children = orchestrator.services.agentLifecycle
        .listAgents()
        .filter((agent) => agent.parentAgentId === parent.id);
      assert.equal(children.length, 2);
      const transcripts = await Promise.all(
        children.map((child) =>
          orchestrator.services.subagentTranscripts.get(parent.id, child.id),
        ),
      );
      assert.ok(
        transcripts.every((transcript) => transcript.activeRun === undefined),
      );
      const runStates = await new WorkbenchRunUnitOfWork(
        storage.paths.home,
        0,
      ).list();
      for (const child of children) {
        const childRuns = runStates.filter(
          (state) => state.run.agentId === child.id,
        );
        assert.equal(childRuns.length, 1);
        assert.equal(
          childRuns[0]?.run.status,
          "cancelled",
          JSON.stringify(childRuns[0]?.run),
        );
        const completion = (
          await orchestrator.services.subagentTranscripts.snapshot(child.id)
        ).latestCompletion;
        assert.equal(completion?.runId, childRuns[0]!.run.runId);
        assert.equal(completion?.outcome, "cancelled");
        assert.equal(completion?.response?.complete ?? false, false);
      }
      const [run] = runStates.filter(
        (state) => state.run.agentId === parent.id,
      );
      assert.equal(run?.run.status, "cancelled", JSON.stringify(run?.run));
      // Cancelling the common model aborts the attached wrapper signal first.
      // By the later subagent sweep its already-settled handles can be gone;
      // the exact cancelled child runs above are the behavioral evidence.
      assert.deepEqual(
        run?.run.cancellationEvidence.map((evidence) => evidence.target),
        ["model", "tool", "task", "subagent", "interaction"],
      );
      assert.ok(
        run?.run.cancellationEvidence.every(
          (evidence) =>
            evidence.status === "confirmed" ||
            evidence.status === "not_running",
        ),
        JSON.stringify(run?.run.cancellationEvidence),
      );
    } finally {
      registration.unregister();
      await shutdownServerRuntime(orchestrator.runtime);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });
});

function hasErrorCode(expected: string): (error: unknown) => boolean {
  return (error) =>
    Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === expected,
    );
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  diagnostic: () => Promise<string>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for explore children: ${await diagnostic()}`,
  );
}
