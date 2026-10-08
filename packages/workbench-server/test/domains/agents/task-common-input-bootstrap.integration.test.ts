import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";

it("detached task producer queues one authenticated untrusted notice while paused, without direct context insertion or activation", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-task-common-input-"));
  const storage = await initializeStorage(home);
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
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
    });
    await runtime.services.workbenchRun.abortAgent(agent.id);
    const task = await runtime.services.tasks.startTask({
      cwd: home,
      command: "printf 'UNTRUSTED TASK OUTPUT\\n'",
      projectId: project.id,
      conversationId: conversation.id,
      agentId: agent.id,
      notify: true,
      origin: { kind: "api" },
      completion: { inject: false, outputTailLineCount: 80 },
    });
    const deadline = Date.now() + 3_000;
    let queue = await runtime.services.workbenchRun.listQueuedPrompts(agent.id);
    while (Date.now() < deadline && !queue.length) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await runtime.services.taskNotifications.recoverPendingNotifications();
      queue = await runtime.services.workbenchRun.listQueuedPrompts(agent.id);
    }
    await runtime.services.taskNotifications.recoverPendingNotifications();
    await runtime.services.taskNotifications.recoverPendingNotifications();
    queue = await runtime.services.workbenchRun.listQueuedPrompts(agent.id);
    assert.equal(queue.length, 1, "task events must use the sole common queue");
    const notice = queue[0]!;
    assert.ok("origin" in notice);
    assert.equal(notice.role, "system");
    assert.equal(notice.notice?.type, "task_event");
    assert.equal(notice.origin.kind, "system");
    assert.equal(notice.activation, "queue_only");
    assert.equal(
      notice.idempotencyKey,
      `task-notification:${task.id}:terminal`,
    );
    assert.match(notice.text, /UNTRUSTED TASK OUTPUT/);
    const history = await runtime.services.subagentTranscripts.snapshot(
      agent.id,
    );
    assert.equal(history.entries.length, 0);
    assert.equal(history.latestCompletion, null);
    assert.equal(
      runtime.services.agentLifecycle.getAgent(agent.id).activationState,
      "paused",
    );
    assert.equal(
      runtime.services.tasks.getTask(task.id).notifications
        ?.terminalDeliveredAt,
      undefined,
      "queue acceptance is not transcript delivery",
    );
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    await rm(home, { recursive: true, force: true });
  }
});

for (const outcome of ["ready", "timeout"] as const) {
  it(`retries ${outcome} task notices with original acceptance despite changing logs before and after delivery`, async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-task-notice-retry-"));
    const storage = await initializeStorage(home);
    const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
    try {
      // Drive recovery explicitly rather than subscribing to live events, so
      // the post-delivery retry sees newer output before acknowledgment.
      // stop() fences recovery too, so leave this fresh service unstarted.
      runtime.services.taskNotifications.start = () => {};
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
        model: { provider: "nerve-faux", modelId: "faux-fast" },
      });
      await runtime.services.workbenchRun.abortAgent(agent.id);
      const script = `
        const fs = require("node:fs");
        console.log(${JSON.stringify(outcome === "ready" ? "READY" : "WAITING")});
        let stage = 0;
        const timer = setInterval(() => {
          if (stage < 2 && fs.existsSync("stage-" + (stage + 1))) {
            console.log("OUTPUT STAGE " + (++stage));
          }
        }, 20);
        setTimeout(() => { clearInterval(timer); process.exit(0); }, 15000);
      `;
      const task = await runtime.services.tasks.startTask({
        cwd: home,
        command: `${JSON.stringify(process.execPath)} -e '${script}'`,
        projectId: project.id,
        conversationId: conversation.id,
        agentId: agent.id,
        readyPattern: "READY",
        readyTimeoutMs: outcome === "ready" ? 3000 : 50,
        notify: true,
        origin: { kind: "api" },
        completion: { inject: false, outputTailLineCount: 80 },
      });
      const tasks = runtime.services.tasks;
      await waitUntil(
        async () => tasks.getTask(task.id).readiness.outcome === outcome,
      );
      await waitUntil(
        async () =>
          (await tasks.queryLogs(task.id, { mode: "recent", limit: 3 })).events
            .length > 0,
      );
      const initialCursor = (
        await tasks.queryLogs(task.id, { mode: "recent", limit: 3 })
      ).nextCursor;
      await runtime.services.taskNotifications.recoverPendingNotifications();
      const inputs = new AgentInputRepository(storage);
      const accepted = (await inputs.load(agent.id))!.inputs[0]!;
      assert.equal(accepted.state, "pending");
      assert.equal(
        accepted.idempotencyKey,
        `task-notification:${task.id}:ready`,
      );
      assert.equal(accepted.role, "system");
      assert.equal(accepted.origin.kind, "system");
      assert.equal(accepted.activation, "queue_only");
      assert.match(accepted.text, new RegExp(`cursor=${initialCursor}`));
      await writeFile(join(home, "stage-1"), "");
      await waitUntil(async () =>
        (
          await tasks.queryLogs(task.id, { mode: "recent", limit: 3 })
        ).events.some((event) => event.line.includes("OUTPUT STAGE 1")),
      );
      assert.notEqual(
        (await tasks.queryLogs(task.id, { mode: "recent", limit: 3 }))
          .nextCursor,
        initialCursor,
      );
      await runtime.services.taskNotifications.recoverPendingNotifications();
      await runtime.services.taskNotifications.recoverPendingNotifications();
      let queueState = (await inputs.load(agent.id))!;
      assert.equal(queueState.inputs.length, 1);
      assert.equal(queueState.inputs[0]!.text, accepted.text);
      const pausedHistory = await runtime.services.subagentTranscripts.snapshot(
        agent.id,
      );
      assert.equal(
        pausedHistory.entries.length,
        0,
        "paused acceptance must not inject directly",
      );
      assert.equal(
        pausedHistory.latestCompletion,
        null,
        "queue-only acceptance must not activate",
      );
      assert.equal(
        runtime.services.agentLifecycle.getAgent(agent.id).activationState,
        "paused",
      );
      assert.equal(
        tasks.getTask(task.id).notifications?.readyDeliveredAt,
        undefined,
      );
      await runtime.services.workbenchRun.resumeAgent(agent.id);
      await waitUntil(
        async () => !!(await inputs.load(agent.id))!.inputs[0]!.delivery,
      );
      await writeFile(join(home, "stage-2"), "");
      await waitUntil(async () =>
        (
          await tasks.queryLogs(task.id, { mode: "recent", limit: 3 })
        ).events.some((event) => event.line.includes("OUTPUT STAGE 2")),
      );
      assert.equal(
        tasks.getTask(task.id).notifications?.readyDeliveredAt,
        undefined,
      );
      await runtime.services.taskNotifications.recoverPendingNotifications();
      await runtime.services.taskNotifications.recoverPendingNotifications();
      queueState = (await inputs.load(agent.id))!;
      assert.equal(
        queueState.inputs.length,
        1,
        "retries must not accept replacement notices",
      );
      const delivered = queueState.inputs[0]!;
      assert.equal(delivered.id, accepted.id);
      assert.equal(delivered.text, accepted.text);
      assert.equal(delivered.state, "delivered");
      assert.equal(
        tasks.getTask(task.id).notifications?.readyEntryId,
        delivered.delivery!.contextEntryId,
      );
      assert.equal(
        tasks.getTask(task.id).notifications?.readyDeliveredAt,
        delivered.delivery!.deliveredAt,
      );
      const history = await runtime.services.subagentTranscripts.snapshot(
        agent.id,
      );
      assert.equal(
        history.entries.filter(
          (entry) => entry.id === delivered.delivery!.contextEntryId,
        ).length,
        1,
      );
      const renderedNotice = history.entries.find(
        (entry) => entry.id === delivered.delivery!.contextEntryId,
      )!;
      assert.equal(renderedNotice.kind, "task_event");
      assert.equal(
        (renderedNotice.details as { type: string }).type,
        "task_event",
      );
      assert.doesNotMatch(renderedNotice.text, /\[Trusted notification/);
    } finally {
      await shutdownServerRuntime(runtime.runtime);
      await rm(home, { recursive: true, force: true });
    }
  });
}

for (const foreignOrigin of [
  { kind: "user", userId: "authorized-user" } as const,
  { kind: "system", producer: "another_producer" } as const,
]) {
  it(`does not acknowledge a task using a same-key ${foreignOrigin.kind} foreign receipt`, async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-task-notice-collision-"));
    const storage = await initializeStorage(home);
    const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
    try {
      // Keep manual recovery active without subscribing to terminal events
      // before the foreign acceptance has been arranged.
      runtime.services.taskNotifications.start = () => {};
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
        model: { provider: "nerve-faux", modelId: "faux-fast" },
      });
      await runtime.services.workbenchRun.abortAgent(agent.id);
      const task = await runtime.services.tasks.startTask({
        cwd: home,
        command: "printf 'TASK OUTPUT\\n'",
        projectId: project.id,
        conversationId: conversation.id,
        agentId: agent.id,
        notify: true,
        origin: { kind: "api" },
        completion: { inject: false, outputTailLineCount: 80 },
      });
      await waitUntil(
        async () =>
          runtime.services.tasks.getTask(task.id).status === "completed",
      );
      const foreign = await runtime.services.workbenchRun.enqueueAgentInput(
        agent.id,
        {
          text: "Foreign input, not a task notification",
          role: "user",
          origin:
            foreignOrigin.kind === "system"
              ? { ...foreignOrigin, correlationId: `${task.id}:terminal` }
              : foreignOrigin,
          idempotencyKey: `task-notification:${task.id}:terminal`,
          eligibility: { kind: "next_turn" },
          activation: "queue_only",
        },
      );
      await runtime.services.taskNotifications.recoverPendingNotifications();
      const inputs = new AgentInputRepository(storage);
      assert.equal((await inputs.load(agent.id))!.inputs.length, 1);
      assert.equal(
        (await runtime.services.subagentTranscripts.snapshot(agent.id)).entries
          .length,
        0,
      );
      assert.equal(
        runtime.services.tasks.getTask(task.id).notifications
          ?.terminalDeliveredAt,
        undefined,
      );
      await runtime.services.workbenchRun.resumeAgent(agent.id);
      await waitUntil(
        async () => !!(await inputs.load(agent.id))!.inputs[0]!.delivery,
      );
      await runtime.services.taskNotifications.recoverPendingNotifications();
      await runtime.services.taskNotifications.recoverPendingNotifications();
      const state = (await inputs.load(agent.id))!;
      assert.equal(
        state.inputs.length,
        1,
        "collision must not replace or duplicate the foreign acceptance",
      );
      assert.equal(state.inputs[0]!.id, foreign.id);
      assert.ok(
        state.inputs[0]!.delivery,
        "foreign input really reached context",
      );
      const notification = runtime.services.tasks.getTask(
        task.id,
      ).notifications;
      assert.equal(
        notification?.terminalDeliveredAt,
        undefined,
        "a foreign delivery cannot acknowledge the task",
      );
      assert.notEqual(
        notification?.terminalEntryId,
        state.inputs[0]!.delivery!.contextEntryId,
      );
      const history = await runtime.services.subagentTranscripts.snapshot(
        agent.id,
      );
      assert.equal(
        history.entries.filter((entry) =>
          entry.text.startsWith("Task event (quoted task output"),
        ).length,
        0,
        "collision must not inject a task notice",
      );
    } finally {
      await shutdownServerRuntime(runtime.runtime);
      await rm(home, { recursive: true, force: true });
    }
  });
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for task/input transition");
}
