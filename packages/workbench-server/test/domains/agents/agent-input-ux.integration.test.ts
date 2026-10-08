import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

async function eventually<T>(
  read: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out awaiting input UX boundary");
}

for (const child of [false, true]) {
  test(`${child ? "child" : "lead"} queued blocks expand in model and transcript; ordinary follow-up reaches next request`, async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-402-input-ux-"));
    const storage = await initializeStorage(home);
    const workspace = join(home, "workspace");
    await mkdir(workspace);
    const provider = registerAgentScriptedProvider({
      provider: `nerve-input-ux-${child}`,
      steps: [],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    provider.setResponses([
      async (context) => {
        requests++;
        assert.match(JSON.stringify(context.messages), /FIRST_OUTPUT/);
        await gate;
        return fauxAssistantMessage("first turn ended");
      },
      async (context) => {
        requests++;
        const text = JSON.stringify(context.messages);
        assert.match(text, /FOLLOW_OUTPUT/);
        assert.doesNotMatch(text, /```!!!/);
        assert.ok(
          text.indexOf("first turn ended") < text.indexOf("follow-up prose"),
        );
        return fauxAssistantMessage("all input delivered");
      },
    ]);
    const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
    try {
      await runtime.lifecycle.hydrate();
      const project = await runtime.services.projectLifecycle.createProject({
        dir: workspace,
      });
      const conversation =
        await runtime.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const parent = child
        ? await runtime.services.agentLifecycle.createAgent({
            projectId: project.id,
            conversationId: conversation.id,
          })
        : undefined;
      const agent = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent?.id,
        model: {
          provider: `nerve-input-ux-${child}`,
          modelId: "scripted-fast",
        },
        permissionLevel: "autonomous",
        permissionRuleSetId: "autonomous",
        tools: ["bash"],
      });
      const marker = join(workspace, "count");
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: `Initial\n\`\`\`!!!\nprintf FIRST_OUTPUT; printf x >> ${JSON.stringify(marker)}\n\`\`\``,
      });
      await eventually(() => (requests === 1 ? true : undefined));
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: "follow-up prose\n```!!!\nprintf FOLLOW_OUTPUT\n```",
        behavior: "follow-up",
      });
      release();
      await eventually(
        async () =>
          (await runtime.services.subagentTranscripts.snapshot(agent.id))
            .latestCompletion ?? undefined,
      );
      assert.equal(requests, 2);
      assert.equal(await readFile(marker, "utf8"), "x");
      const history = await runtime.services.subagentTranscripts.snapshot(
        agent.id,
      );
      const prompts = history.entries.filter((entry) => entry.role === "user");
      assert.equal(prompts.length, 2);
      assert.match(prompts[0]!.text, /FIRST_OUTPUT/);
      assert.match(prompts[1]!.text, /FOLLOW_OUTPUT/);
      assert.match(prompts[1]!.text, /status: completed/);
      assert.ok(prompts.every((entry) => !entry.text.includes("```!!!")));
      assert.deepEqual(
        await runtime.services.workbenchRun.listQueuedPrompts(agent.id),
        [],
      );
      if (parent)
        assert.equal(
          (await runtime.services.subagentTranscripts.snapshot(parent.id))
            .entries.length,
          0,
        );
    } finally {
      release();
      await shutdownServerRuntime(runtime.runtime);
      provider.unregister();
      await rm(home, { recursive: true, force: true });
    }
  });

  test(`${child ? "child" : "lead"} force-push cancels active tools and retains their responses before same-run continuation`, async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-402-force-ux-"));
    const providerName = `nerve-force-ux-${child}`;
    const provider = registerAgentScriptedProvider({
      provider: providerName,
      steps: [],
    });
    let requests = 0;
    provider.setResponses([
      async () => {
        requests++;
        return fauxAssistantMessage([
          fauxToolCall(
            "bash",
            { command: "printf COMPLETED_BEFORE_PUSH" },
            { id: "quick_call" },
          ),
          fauxToolCall(
            "bash",
            { command: "sleep 30", timeout: 60 },
            { id: "slow_call" },
          ),
        ]);
      },
      async (context) => {
        requests++;
        const roles = context.messages.map((message) => message.role);
        assert.ok(roles.includes("assistant"));
        assert.equal(roles.filter((role) => role === "toolResult").length, 2);
        assert.match(
          JSON.stringify(
            context.messages.filter((message) => message.role === "toolResult"),
          ),
          /COMPLETED_BEFORE_PUSH/,
        );
        assert.equal(context.messages.at(-1)?.role, "user");
        const text = JSON.stringify(context.messages);
        assert.match(text, /urgent user follow-up/);
        assert.match(text, /abort|cancel|interrupt/i);
        return fauxAssistantMessage("continued after interruption");
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
      const parent = child
        ? await runtime.services.agentLifecycle.createAgent({
            projectId: project.id,
            conversationId: conversation.id,
          })
        : undefined;
      const agent = await runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent?.id,
        model: { provider: providerName, modelId: "scripted-fast" },
        permissionLevel: "autonomous",
        permissionRuleSetId: "autonomous",
        tools: ["bash"],
      });
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: "start slow tool",
      });
      await eventually(() =>
        runtime.services.tools
          .listToolCalls()
          .find(
            (tool) => tool.agentId === agent.id && tool.status === "running",
          ),
      );
      await eventually(async () =>
        (
          await runtime.services.tools.listToolCallPreviews({
            agentId: agent.id,
          })
        ).some((tool) => tool.status === "completed")
          ? true
          : undefined,
      );
      const runId = (
        await runtime.services.subagentTranscripts.snapshot(agent.id)
      ).activeRun!.runId;
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: "urgent user follow-up",
        behavior: "follow-up",
      });
      const receipt =
        await runtime.services.workbenchRun.forcePushQueuedPrompts(
          agent.id,
          "push_once",
        );
      assert.equal(receipt.runId, runId);
      const completed = await eventually(
        async () =>
          (await runtime.services.subagentTranscripts.snapshot(agent.id))
            .latestCompletion ?? undefined,
      );
      assert.equal(completed.runId, runId);
      assert.equal(completed.outcome, "completed");
      assert.equal(requests, 2);
      const history = await runtime.services.subagentTranscripts.snapshot(
        agent.id,
      );
      assert.ok(history.entries.some((entry) => entry.kind === "tool_result"));
      assert.equal(
        history.entries.filter(
          (entry) => entry.text === "urgent user follow-up",
        ).length,
        1,
      );
      assert.deepEqual(
        await runtime.services.workbenchRun.listQueuedPrompts(agent.id),
        [],
      );
      assert.equal(
        runtime.services.agentLifecycle.getAgent(agent.id).activationState,
        "enabled",
      );
    } finally {
      await shutdownServerRuntime(runtime.runtime);
      provider.unregister();
      await rm(home, { recursive: true, force: true });
    }
  });
}
