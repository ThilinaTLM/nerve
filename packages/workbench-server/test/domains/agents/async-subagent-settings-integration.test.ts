import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { asyncSubagentToolNames } from "@nervekit/contracts/agents";
import {
  initializeStorage,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

it("creates teammates with the configured project model while retaining the lead model otherwise", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-async-settings-"));
  const storage = await initializeStorage(root);
  const configuredModel = { provider: "xai", modelId: "grok-4.5" };
  storage.settings = await writeSettings(storage, {
    asyncSubagent: { model: configuredModel },
    tools: {
      disabled: storage.settings.tools.disabled.filter(
        (name) => !(asyncSubagentToolNames as readonly string[]).includes(name),
      ),
    },
  });
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await runtime.lifecycle.hydrate();
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    const project = await runtime.services.projectLifecycle.createProject({
      dir: projectDir,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const lead = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      permissionLevel: "autonomous",
      model: { provider: "openai", modelId: "gpt-5.6-sol" },
    });
    await runtime.services.asyncSubagents.create(lead.id, "configured", true);
    const child = runtime.services.agentLifecycle
      .listAgents()
      .find((agent) => agent.parentAgentId === lead.id)!;
    assert.deepEqual(child.model, configuredModel);
    await mkdir(join(projectDir, ".nerve", "config"), { recursive: true });
    await writeFile(
      join(projectDir, ".nerve", "config", "harness.json"),
      JSON.stringify({ asyncSubagent: { model: lead.model } }),
    );
    await runtime.services.asyncSubagents.create(lead.id, "project", true);
    const projectChild = runtime.services.agentLifecycle
      .listAgents()
      .find(
        (agent) => agent.parentAgentId === lead.id && agent.name === "project",
      )!;
    assert.deepEqual(projectChild.model, lead.model);
    assert.deepEqual(child.model, configuredModel);
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    await rm(root, { recursive: true, force: true });
  }
});
