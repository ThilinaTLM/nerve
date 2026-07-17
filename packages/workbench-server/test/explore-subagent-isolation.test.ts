import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import {
  createOrchestratorState,
  shutdownOrchestratorState,
} from "../src/app/orchestrator-state.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

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
    storage.settings.exploreAgent = {
      ...storage.settings.exploreAgent,
      model: { provider, modelId: "scripted-fast" },
    };
    const orchestrator = createOrchestratorState(storage, "127.0.0.1", 0);
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
      const parentHarnessPath = join(
        root,
        "conversations",
        conversation.id,
        "harness.jsonl",
      );
      const parentHarnessBefore = await readFile(parentHarnessPath, "utf8");

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
      assert.match(child.systemPrompt ?? "", new RegExp(root));
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
      assert.equal(
        await readFile(parentHarnessPath, "utf8"),
        parentHarnessBefore,
      );

      const childHarness = await readFile(
        join(root, "agents", child.id, "conversation.jsonl"),
        "utf8",
      );
      assert.match(childHarness, /focused read-only verification/);
      assert.match(childHarness, /Task-specific context/);
      assert.match(
        childHarness,
        /relative ls paths start from the project root/,
      );
      assert.match(childHarness, /temporary project is isolated/i);

      const childToolCalls = orchestrator.registry.tools
        .listToolCalls()
        .filter((toolCall) => toolCall.agentId === child.id);
      assert.equal(childToolCalls.length, 1);
      assert.equal(childToolCalls[0]?.toolName, "ls");
      assert.equal(childToolCalls[0]?.status, "completed");
      assert.equal(childToolCalls[0]?.hidden, true);
      assert.equal(
        snapshot.toolCalls.some((toolCall) => toolCall.agentId === child.id),
        false,
      );
    } finally {
      registration.unregister();
      await shutdownOrchestratorState(orchestrator);
      await rm(root, { recursive: true, force: true });
    }
  });
});
