import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

async function wait(read: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Preparation interruption did not settle");
}

test("force-push can interrupt command preparation before the first provider request without repeating shell work", async () => {
  const home = await mkdtemp(
    join(tmpdir(), "nerve-402-preparation-interrupt-"),
  );
  const provider = registerAgentScriptedProvider({
    provider: "nerve-preparation-interrupt",
    steps: [],
  });
  let requests = 0;
  provider.setResponses([
    async (context) => {
      requests++;
      const text = JSON.stringify(context.messages);
      assert.match(text, /urgent during preparation/);
      assert.match(text, /cancel|abort|interrupt/i);
      assert.doesNotMatch(text, /```!!!/);
      return fauxAssistantMessage("preparation cancelled and input received");
    },
  ]);
  const runtime = createRuntimeFixture(
    await initializeStorage(home),
    "127.0.0.1",
    0,
  );
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
      model: {
        provider: "nerve-preparation-interrupt",
        modelId: "scripted-fast",
      },
      permissionLevel: "autonomous",
      permissionRuleSetId: "autonomous",
      tools: ["bash"],
    });
    const accepted = await runtime.services.workbenchRun.promptAgent(agent.id, {
      text: "```!!!\nsleep 30\n```",
    });
    await wait(() =>
      runtime.services.tools
        .listToolCalls()
        .some((tool) => tool.agentId === agent.id && tool.status === "running"),
    );
    assert.equal(requests, 0);
    await runtime.services.workbenchRun.promptAgent(agent.id, {
      text: "urgent during preparation",
    });
    await runtime.services.workbenchRun.forcePushQueuedPrompts(
      agent.id,
      "interrupt_preparation",
    );
    await wait(async () =>
      Boolean(
        (await runtime.services.subagentTranscripts.snapshot(agent.id))
          .latestCompletion,
      ),
    );
    assert.equal(
      requests,
      1,
      JSON.stringify(
        (await runtime.services.subagentTranscripts.snapshot(agent.id))
          .latestCompletion,
      ),
    );
    const preparations = await runtime.services.tools.listToolCallPreviews({
      agentId: agent.id,
    });
    assert.equal(
      preparations.filter(
        (tool) => tool.providerToolCallId === `input-block:${accepted!.id}:0`,
      ).length,
      1,
    );
    assert.deepEqual(
      await runtime.services.workbenchRun.listQueuedPrompts(agent.id),
      [],
    );
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    provider.unregister();
    await rm(home, { recursive: true, force: true });
  }
});
