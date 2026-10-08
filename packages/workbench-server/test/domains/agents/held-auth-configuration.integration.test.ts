import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

for (const child of [false, true])
  test(`held credentials refresh ${child ? "child" : "root"} common runtime before actual dispatch`, async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-402-held-auth-"));
    const oldId = `nerve-held-old-${child}`;
    const nextId = `nerve-held-next-${child}`;
    const old = registerAgentScriptedProvider({
      provider: oldId,
      steps: [{ type: "assistantText", text: "STALE" }],
    });
    const next = registerAgentScriptedProvider({ provider: nextId, steps: [] });
    let requests = 0;
    next.setResponses([
      async (context) => {
        requests++;
        assert.match(JSON.stringify(context), /LATEST_INSTRUCTION/);
        assert.match(JSON.stringify(context), /ORIGINAL_PROMPT/);
        return fauxAssistantMessage("LATEST_RESPONSE");
      },
    ]);
    const runtime = createRuntimeFixture(
      await initializeStorage(home),
      "127.0.0.1",
      0,
    );
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const authModels: string[] = [];
    const originalAuth = runtime.runtime.auth.requestAuthForPiModel.bind(
      runtime.runtime.auth,
    );
    runtime.runtime.auth.requestAuthForPiModel = async (model) => {
      if (model.provider === oldId || model.provider === nextId)
        authModels.push(model.provider);
      if (model.provider === oldId) {
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
        model: { provider: oldId, modelId: "scripted-fast" },
        tools: [],
      });
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: "ORIGINAL_PROMPT",
      });
      await held;
      const replacement = await runtime.services.agentLifecycle.configureAgent(
        agent.id,
        {
          model: { provider: nextId, modelId: "scripted-fast" },
          instructions: "LATEST_INSTRUCTION",
          tools: [],
          skills: null,
        },
      );
      assert.equal(replacement.effectiveConfigurationRevision, 0);
      release();
      const deadline = Date.now() + 10_000;
      let history = await runtime.services.workbenchRun.getAgentHistory(
        agent.id,
      );
      while (
        !history.some((entry) => entry.text?.includes("LATEST_RESPONSE")) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        history = await runtime.services.workbenchRun.getAgentHistory(agent.id);
      }
      assert.ok(
        history.some((entry) => entry.text?.includes("LATEST_RESPONSE")),
        JSON.stringify(history),
      );
      assert.ok(!history.some((entry) => entry.text?.includes("STALE")));
      assert.equal(requests, 1);
      assert.deepEqual(authModels, [oldId, nextId]);
      assert.equal(
        runtime.services.agentLifecycle.getAgent(agent.id)
          .effectiveConfigurationRevision,
        2,
      );
    } finally {
      release();
      await shutdownServerRuntime(runtime.runtime);
      old.unregister();
      next.unregister();
      await rm(home, { recursive: true, force: true });
    }
  });

for (const scenario of ["invalid", "churn", "stop"] as const)
  test(`held auth ${scenario} never dispatches a stale request`, async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-402-held-blocker-"));
    const providerId = `nerve-held-${scenario}`;
    const provider = registerAgentScriptedProvider({
      provider: providerId,
      steps: [],
    });
    let requests = 0;
    provider.setResponses([
      () => {
        requests++;
        return fauxAssistantMessage("STALE_REQUEST");
      },
    ]);
    const runtime = createRuntimeFixture(
      await initializeStorage(home),
      "127.0.0.1",
      0,
    );
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalAuth = runtime.runtime.auth.requestAuthForPiModel.bind(
      runtime.runtime.auth,
    );
    let actorId = "";
    let authCalls = 0;
    runtime.runtime.auth.requestAuthForPiModel = async (model) => {
      if (model.provider === providerId) {
        authCalls++;
        if (authCalls === 1) {
          entered();
          await gate;
        } else if (scenario === "churn")
          await runtime.services.agentLifecycle.configureAgent(actorId, {
            instructions: `churn ${authCalls}`,
          });
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
      actorId = agent.id;
      await runtime.services.workbenchRun.promptAgent(agent.id, {
        text: "ORIGINAL_PROMPT",
      });
      await held;
      if (scenario === "stop")
        await runtime.services.workbenchRun.abortAgent(agent.id);
      else
        await runtime.services.agentLifecycle.configureAgent(
          agent.id,
          scenario === "invalid"
            ? { model: { provider: providerId, modelId: "missing-model" } }
            : { instructions: "first supersession" },
        );
      release();
      const deadline = Date.now() + 10_000;
      let run;
      while (Date.now() < deadline) {
        const history = await runtime.services.workbenchRun.getAgentHistory(
          agent.id,
        );
        const runId = history.find((entry) => entry.runId)?.runId;
        run = runId
          ? await runtime.services.workbenchRun.loadRunState(runId)
          : undefined;
        if (
          run &&
          ["failed", "cancelled", "interrupted", "aborted"].includes(
            run.run.status,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(requests, 0);
      assert.equal(
        runtime.services.agentLifecycle.getAgent(agent.id)
          .effectiveConfigurationRevision,
        0,
      );
      if (scenario !== "stop") {
        assert.equal(run?.run.status, "failed", JSON.stringify(run));
        assert.equal(
          run?.run.failure?.code,
          "AGENT_CONFIGURATION_BLOCKED",
          JSON.stringify(run),
        );
        assert.equal(authCalls, scenario === "churn" ? 8 : 1);
        const queue = await new AgentInputRepository(
          runtime.runtime.storage,
        ).load(agent.id);
        assert.equal(
          queue?.admissionBlocker?.configurationRevision,
          runtime.services.agentLifecycle.getAgent(agent.id)
            .configurationRevision,
        );
      }
    } finally {
      release();
      await shutdownServerRuntime(runtime.runtime);
      provider.unregister();
      await rm(home, { recursive: true, force: true });
    }
  });

test("held auth effective-write failure never clears durable pending context", async () => {
  const home = await mkdtemp(
    join(tmpdir(), "nerve-402-effective-write-failure-"),
  );
  const providerId = "nerve-held-effective-write";
  const provider = registerAgentScriptedProvider({
    provider: providerId,
    steps: [],
  });
  let requests = 0;
  provider.setResponses([
    () => {
      requests++;
      return fauxAssistantMessage("MUST_NOT_DISPATCH");
    },
  ]);
  const runtime = createRuntimeFixture(
    await initializeStorage(home),
    "127.0.0.1",
    0,
  );
  const store = runtime.runtime.storage.canonicalStore;
  const write = store.writeDocument.bind(store);
  const auth = runtime.runtime.auth.requestAuthForPiModel.bind(
    runtime.runtime.auth,
  );
  let entered!: () => void, release!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.runtime.auth.requestAuthForPiModel = async (model) => {
    if (model.provider === providerId) {
      entered();
      await gate;
    }
    return auth(model);
  };
  let effectiveWrites = 0;
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
    await runtime.services.workbenchRun.promptAgent(agent.id, {
      text: "DURABLE_UNDISPATCHED_INPUT",
    });
    await held;
    const repository = new AgentInputRepository(runtime.runtime.storage);
    assert.equal((await repository.load(agent.id))?.contextPending, true);
    store.writeDocument = async (input) => {
      if (
        input.namespace === "agent" &&
        input.documentId === agent.id &&
        (input.data as { effectiveConfigurationRevision?: number })
          .effectiveConfigurationRevision
      ) {
        effectiveWrites++;
        throw new Error("Injected effective revision persistence failure");
      }
      return write(input);
    };
    release();
    const deadline = Date.now() + 10_000;
    let run;
    while (Date.now() < deadline) {
      const history = await runtime.services.workbenchRun.getAgentHistory(
        agent.id,
      );
      const runId = history.find((entry) => entry.runId)?.runId;
      run = runId
        ? await runtime.services.workbenchRun.loadRunState(runId)
        : undefined;
      if (
        run?.run.failure?.message.includes(
          "Injected effective revision persistence failure",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(effectiveWrites > 0);
    assert.equal(requests, 0);
    assert.match(
      run?.run.failure?.message ?? "",
      /Injected effective revision persistence failure/,
    );
    assert.equal((await repository.load(agent.id))?.contextPending, true);
    assert.equal(
      runtime.services.agentLifecycle.getAgent(agent.id)
        .effectiveConfigurationRevision,
      0,
    );
  } finally {
    release();
    store.writeDocument = write;
    await shutdownServerRuntime(runtime.runtime);
    provider.unregister();
    await rm(home, { recursive: true, force: true });
  }
});
