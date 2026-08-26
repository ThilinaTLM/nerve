import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness";
import { conversationStream } from "@nervekit/contracts";
import {
  createWorkbenchState,
  shutdownWorkbenchState,
} from "../src/app/workbench-state.js";
import {
  initializeStorage,
  writeSettings,
} from "../src/infrastructure/storage/index.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";
import { ConversationJournalRepository } from "../src/domains/conversations/conversation-journal.repository.js";

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
      ],
    });
    const root = await mkdtemp(join(tmpdir(), "nerve-explore-isolation-"));
    const storage = await initializeStorage(root);
    await writeSettings(storage, {
      exploreAgent: {
        model: { provider, modelId: "scripted-fast" },
      },
    });
    const orchestrator = createWorkbenchState(storage, "127.0.0.1", 0);
    try {
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const parent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });
      const result = await orchestrator.registry.requestTool(
        parent.id,
        "explore",
        {
          tasks: [
            {
              task: "Inspect the temporary project and summarize its contents.",
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

      const child = orchestrator.registry
        .listAgents()
        .find((agent) => agent.parentAgentId === parent.id);
      assert.ok(child);
      assert.equal(child.status, "idle");
      assert.ok((child.systemPrompt ?? "").includes(project.dir));
      assert.match(
        child.systemPrompt ?? "",
        /NERVE_HOME.*artifacts, not the source root/,
      );
      assert.equal(
        orchestrator.registry.getConversation(conversation.id).activeAgentId,
        parent.id,
      );

      const snapshot = await orchestrator.registry.getConversationSnapshot(
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

      const childToolCalls = orchestrator.registry.tools.listToolCallPreviews({
        agentId: child.id,
        limit: 10,
      });
      assert.equal(childToolCalls.length, 1);
      assert.equal(childToolCalls[0]?.toolName, "ls");
      assert.equal(childToolCalls[0]?.status, "completed");
      assert.equal(childToolCalls[0]?.hidden, true);
      const childTranscript =
        await orchestrator.registry.subagentTranscripts.get(
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

      const stream = await orchestrator.events.readStream(
        conversationStream(conversation.id),
        1,
        1_000,
      );
      const dedicated = stream.events.filter((event) =>
        event.type.startsWith("agent.subagent_transcript."),
      );
      assert.ok(dedicated.length > 0);
      assert.equal(dedicated[0]?.type, "agent.subagent_transcript.run.started");
      assert.equal(
        dedicated.at(-1)?.type,
        "agent.subagent_transcript.run.completed",
      );
      assert.equal(
        stream.events.some(
          (event) =>
            event.type.startsWith("conversation.live.") &&
            (event.data as { agentId?: string }).agentId === child.id,
        ),
        false,
      );
      const dedicatedJson = JSON.stringify(dedicated);
      assert.doesNotMatch(dedicatedJson, /explore_ls_1|arguments|result|cwd/);
      await assert.rejects(
        orchestrator.registry.subagentTranscripts.get(child.id, parent.id),
        hasErrorCode("SUBAGENT_TRANSCRIPT_NOT_FOUND"),
      );
      assert.equal(
        snapshot.toolCalls.some((toolCall) => toolCall.agentId === child.id),
        false,
      );
      await assert.rejects(
        orchestrator.registry.promptAgent(child.id, { text: "Continue." }),
        hasErrorCode("SUBAGENT_NOT_INTERACTIVE"),
      );
      await assert.rejects(
        orchestrator.registry.configureAgent(child.id, { mode: "planning" }),
        hasErrorCode("SUBAGENT_NOT_INTERACTIVE"),
      );
      assert.equal(
        orchestrator.registry.getConversation(conversation.id).activeAgentId,
        parent.id,
      );
    } finally {
      registration.unregister();
      await shutdownWorkbenchState(orchestrator);
      await rm(root, {
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
    const orchestrator = createWorkbenchState(storage, "127.0.0.1", 0);
    let restarted: ReturnType<typeof createWorkbenchState> | undefined;
    try {
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const parent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });
      const child = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent.id,
        task: "Recovery fixture",
      });
      assert.equal(
        orchestrator.registry.getConversation(conversation.id).activeAgentId,
        parent.id,
      );

      await shutdownWorkbenchState(orchestrator);
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
      restarted = createWorkbenchState(restartedStorage, "127.0.0.1", 0);
      await restarted.registry.hydrate();
      assert.equal(
        restarted.registry.getConversation(conversation.id).activeAgentId,
        parent.id,
      );
      const persisted = (
        await new ConversationJournalRepository(restartedStorage).load(
          conversation.id,
        )
      ).conversation;
      assert.equal(persisted?.activeAgentId, parent.id);
    } finally {
      await shutdownWorkbenchState(orchestrator);
      if (restarted) await shutdownWorkbenchState(restarted);
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
    const orchestrator = createWorkbenchState(storage, "127.0.0.1", 0);
    try {
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const parent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider, modelId: "scripted-fast" },
      });

      await orchestrator.registry.promptAgent(parent.id, {
        text: "Start both explore children.",
      });
      await waitUntil(() => {
        const children = orchestrator.registry
          .listAgents()
          .filter((agent) => agent.parentAgentId === parent.id);
        return (
          children.length === 2 &&
          children.every((agent) => agent.status === "running")
        );
      });
      assert.equal(
        orchestrator.registry.getConversation(conversation.id).activeAgentId,
        parent.id,
      );
      await orchestrator.registry.abortAgent(parent.id);

      const children = orchestrator.registry
        .listAgents()
        .filter((agent) => agent.parentAgentId === parent.id);
      assert.equal(children.length, 2);
      assert.ok(children.every((agent) => agent.status === "aborted"));
      const [run] = (
        await new WorkbenchRunUnitOfWork(storage.paths.home, 0).list()
      ).filter((state) => state.run.agentId === parent.id);
      assert.equal(run?.run.status, "cancelled");
      assert.equal(
        run?.run.cancellationEvidence.find(
          (evidence) => evidence.target === "subagent",
        )?.status,
        "confirmed",
      );
    } finally {
      registration.unregister();
      await shutdownWorkbenchState(orchestrator);
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for explore children");
}
