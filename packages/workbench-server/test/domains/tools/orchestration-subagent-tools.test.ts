import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { asyncSubagentToolNames } from "@nervekit/contracts/agents";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import {
  initializeStorage,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";

it("dispatches ID-only controls to an Explore child and rejects ambiguous or promptless controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-explore-controls-"));
  const provider = "nerve-scripted-explore-controls";
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [
      { type: "assistantText", text: "Initial exploration complete." },
      { type: "assistantText", text: "Configured follow-up complete." },
    ],
  });
  const storage = await initializeStorage(root);
  storage.settings = await writeSettings(storage, {
    ...storage.settings,
    tools: {
      ...storage.settings.tools,
      disabled: storage.settings.tools.disabled.filter(
        (name) => !(asyncSubagentToolNames as readonly string[]).includes(name),
      ),
    },
  });
  const fixture = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await fixture.lifecycle.hydrate();
    const services = fixture.services;
    const project = await services.projectLifecycle.createProject({
      dir: root,
    });
    const conversation =
      await services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const parent = await services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      permissionLevel: "autonomous",
      model: { provider, modelId: "scripted-fast" },
    });
    const explored = await services.tools.requestTool(parent, "explore", {
      tasks: [
        {
          task: "Inspect this isolated project and report its contents.",
          label: "Project contents",
        },
      ],
      context:
        "The parent inspected the project directory and needs a focused read-only inventory of its contents.",
    });
    assert.equal(explored.toolCall.status, "completed");
    const child = services.agentLifecycle
      .listAgents()
      .find((agent) => agent.parentAgentId === parent.id)!;
    assert.ok(child);
    assert.equal(child.orchestrationPolicy?.preset, "explore");
    const status = await services.tools.requestTool(parent, "subagent_status", {
      agentId: child.id,
    });
    assert.equal(status.toolCall.status, "completed");
    assert.equal(status.toolCall.result?.details?.agentId, child.id);

    for (const tool of [
      "subagent_status",
      "subagent_stop",
      "subagent_prompt",
    ] as const) {
      const collision = await services.tools.requestTool(parent, tool, {
        agentId: child.id,
        name: child.name,
        ...(tool === "subagent_prompt"
          ? { prompt: "Must not be accepted" }
          : {}),
      });
      assert.equal(collision.toolCall.status, "denied", tool);
    }
    const stopped = await services.tools.requestTool(parent, "subagent_stop", {
      agentId: child.id,
    });
    assert.equal(stopped.toolCall.status, "completed");
    assert.equal(stopped.toolCall.result?.details?.agentId, child.id);
    assert.equal(
      services.agentLifecycle.getAgent(child.id).activationState,
      "paused",
    );
    for (const control of [
      { configuration: { mode: "planning" } },
      { resume: true },
    ]) {
      const invalid = await services.tools.requestTool(
        parent,
        "subagent_prompt",
        { agentId: child.id, ...control },
      );
      assert.equal(invalid.toolCall.status, "denied");
    }
    assert.equal(
      services.agentLifecycle.getAgent(child.id).activationState,
      "paused",
    );
    assert.equal(services.agentLifecycle.getAgent(child.id).mode, "coding");

    const prompted = await services.tools.requestTool(
      parent,
      "subagent_prompt",
      {
        agentId: child.id,
        prompt: "Continue the read-only inventory in planning mode.",
        resume: true,
        configuration: { mode: "planning" },
      },
    );
    assert.equal(
      prompted.toolCall.status,
      "completed",
      JSON.stringify(prompted.toolCall.result),
    );
    assert.equal(prompted.toolCall.result?.details?.agentId, child.id);
    const updated = services.agentLifecycle.getAgent(child.id);
    assert.equal(updated.activationState, "enabled");
    assert.equal(updated.mode, "planning");
    assert.equal(updated.readOnlyCeiling, true);
    const inputId = prompted.toolCall.result?.details?.inputId;
    assert.equal(typeof inputId, "string");
    const inputs = await new AgentInputRepository(storage).load(child.id);
    const accepted = inputs?.inputs.find((input) => input.id === inputId);
    assert.ok(accepted);
    assert.equal(accepted.origin.kind, "parent");
    if (accepted.origin.kind === "parent")
      assert.equal(accepted.origin.agentId, parent.id);
  } finally {
    registration.unregister();
    await shutdownServerRuntime(fixture.runtime);
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});
