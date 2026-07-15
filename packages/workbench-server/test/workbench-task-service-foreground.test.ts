import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createManager,
  fakeChild,
  fakeSupervisor,
  runtimeMetadata,
  seedTaskRecord,
  waitForTaskEvent,
} from "./helpers/workbench-task-service.js";

describe("task manager foreground bash auto-promotion", () => {
  it("promotes a still-running foreground bash task with agent scope", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const updates: Array<{ stream: string; chunk: string }> = [];
    const startedEvent = waitForTaskEvent(events, "task.started");

    const run = manager.runForegroundBashWithPromotion({
      command: "pnpm check",
      cwd: storage.paths.home,
      workerId: "worker_test",
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      autoPromoteAfterMs: 20,
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
      onOutput: (update) => updates.push(update),
    });
    const started = await startedEvent;
    child.stdout.emit("data", "still running\n");

    const result = await run;

    assert.equal(result.kind, "promoted");
    assert.equal(result.task.id, started.id);
    assert.equal(result.task.projectId, "proj_test");
    assert.equal(result.task.conversationId, "conv_test");
    assert.equal(result.task.agentId, "agent_test");
    assert.equal(result.task.workerId, "worker_test");
    assert.equal(result.task.visibility, "background");
    assert.equal(result.task.notifications?.enabled, true);
    assert.equal(result.task.notifications?.terminal, true);
    assert.equal(result.task.completion?.inject, true);
    assert.match(result.result.content ?? "", /was backgrounded/);
    assert.deepEqual(
      (result.result.details as { execution?: unknown }).execution,
      {
        disposition: "backgrounded",
        taskId: result.task.id,
        status: "running",
        elapsedMs: result.elapsedMs,
        terminalUpdate: "automatic",
      },
    );
    assert.equal(
      "task" in (result.result.details as Record<string, unknown>),
      false,
    );
    assert.deepEqual(
      updates.map((update) => [update.stream, update.chunk]),
      [["stdout", "still running\n"]],
    );

    const logs = await manager.queryLogs(result.task.id);
    assert.deepEqual(
      logs.events.map((event) => event.line),
      ["still running"],
    );
  });

  it("passes configured runtime shellPath to foreground task spawn", async () => {
    const child = fakeChild();
    const { supervisor, spawnCalls } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    storage.settings.runtime.shellPath = "/custom/bash";
    const startedEvent = waitForTaskEvent(events, "task.started");

    const run = manager.runForegroundBashWithPromotion({
      command: "pnpm check",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      autoPromoteAfterMs: 1000,
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    const started = await startedEvent;
    child.emitClose(0, null);
    await run;

    assert.equal(spawnCalls[0]?.command, "pnpm check");
    assert.equal(spawnCalls[0]?.options.shellPath, "/custom/bash");
    assert.equal(started.command, "pnpm check");
  });

  it("returns normal bash output and removes the hidden task when it finishes before promotion", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const run = manager.runForegroundBashWithPromotion({
      command: "node fake.js",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      autoPromoteAfterMs: 1000,
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    const started = await startedEvent;
    const completedEvent = waitForTaskEvent(
      events,
      "task.completed",
      started.id,
    );
    child.stdout.emit("data", "out 1\n");
    child.stderr.emit("data", "err 1\n");
    child.stdout.emit("data", "out 2\n");
    child.emitClose(0, null);
    await completedEvent;

    const result = await run;

    assert.equal(result.kind, "completed_foreground");
    assert.deepEqual(
      (result.result.details as { execution?: unknown }).execution,
      { disposition: "completed" },
    );
    assert.equal(result.result.stdout, "out 1\nout 2");
    assert.equal(result.result.stderr, "err 1");
    assert.equal(result.result.content, "out 1\nerr 1\nout 2\n");
    assert.throws(() => manager.getTask(started.id), /Task not found/);
  });

  it("returns a structured timeout result before promotion when a short timeout fires", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        if (signal === "SIGTERM") child.emitClose(null, signal);
      },
    });
    const { manager, storage, events } = await createManager(supervisor);
    const startedEvent = waitForTaskEvent(events, "task.started");

    const run = manager.runForegroundBashWithPromotion({
      command: "sleep forever",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      timeoutMs: 20,
      autoPromoteAfterMs: 1000,
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    const started = await startedEvent;
    const timedOutEvent = waitForTaskEvent(
      events,
      "task.timed_out",
      started.id,
    );
    const timedOut = await timedOutEvent;
    const result = await run;

    assert.equal(timedOut.status, "timed_out");
    assert.equal(result.kind, "completed_foreground");
    assert.equal(result.result.exitCode, 124);
    assert.equal(
      (result.result.details as { timedOut?: boolean }).timedOut,
      true,
    );
    assert.deepEqual(terminateSignals, ["SIGTERM"]);
    assert.throws(() => manager.getTask(started.id), /Task not found/);
  });

  it("hydrates active foreground bash tasks as visible orphaned tasks", async () => {
    const runtime = runtimeMetadata({ childPid: 4321, processGroupId: 4321 });
    const { supervisor } = fakeSupervisor({ runtime });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, {
      status: "running",
      visibility: "foreground",
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
      completion: { inject: false, outputTailLineCount: 80 },
      notifications: {
        enabled: false,
        ready: false,
        terminal: false,
        outputTailLineCount: 80,
      },
      runtime,
    });

    await manager.hydrate();

    const hydrated = manager.getTask(record.id);
    assert.equal(hydrated.status, "orphaned");
    assert.equal(hydrated.visibility, "background");
    assert.equal(hydrated.notifications?.enabled, true);
    assert.equal(hydrated.notifications?.terminal, true);
    assert.equal(hydrated.completion?.inject, true);
  });
});
