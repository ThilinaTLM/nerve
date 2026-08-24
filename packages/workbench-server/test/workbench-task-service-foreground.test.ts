import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  it("keeps a promoted task supervised for explicit cancellation", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        child.emitClose(null, signal);
      },
    });
    const { manager, storage } = await createManager(supervisor);

    const result = await manager.runForegroundBashWithPromotion({
      command: "long-running command",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      autoPromoteAfterMs: 10,
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    assert.equal(result.kind, "promoted");

    const cancelled = await manager.cancelTask(result.task.id, {
      signal: "SIGKILL",
      reason: "Stopped from the task panel.",
    });

    assert.deepEqual(terminateSignals, ["SIGKILL"]);
    assert.equal(cancelled.status, "cancelled");
  });

  it("force-kills a promoted active task during shutdown", async () => {
    const child = fakeChild();
    const { supervisor, terminateSignals } = fakeSupervisor({
      child,
      onTerminate(signal) {
        child.emitClose(null, signal);
      },
    });
    const { manager, storage } = await createManager(supervisor);

    const result = await manager.runForegroundBashWithPromotion({
      command: "long-running command",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      autoPromoteAfterMs: 10,
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    assert.equal(result.kind, "promoted");

    await manager.shutdown();

    assert.deepEqual(terminateSignals, ["SIGKILL"]);
    assert.equal(manager.getTask(result.task.id).status, "cancelled");
  });

  it(
    "returns normal bash output and removes the hidden task when it finishes before promotion",
    { timeout: 10_000 },
    async () => {
      const child = fakeChild();
      let spawned!: () => void;
      const didSpawn = new Promise<void>((resolve) => {
        spawned = resolve;
      });
      const { supervisor } = fakeSupervisor({ child, onSpawn: spawned });
      const { manager, storage, events } = await createManager(supervisor);
      const startedEvent = waitForTaskEvent(events, "task.started");
      const updates: string[] = [];
      let settled = false;
      let resolveFirstOutput!: () => void;
      const firstOutput = new Promise<void>((resolve) => {
        resolveFirstOutput = resolve;
      });

      const run = manager.runForegroundBashWithPromotion({
        command: "node fake.js",
        cwd: storage.paths.home,
        projectId: "proj_test",
        conversationId: "conv_test",
        agentId: "agent_test",
        autoPromoteAfterMs: 1000,
        origin: { kind: "agent_tool", toolCallId: "tool_test" },
        onOutput: (update) => {
          if (update.kind !== "output") return;
          updates.push(update.chunk);
          if (updates.length === 1) resolveFirstOutput();
        },
      });
      void run.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const started = await startedEvent;
      await didSpawn;
      const completedEvent = waitForTaskEvent(
        events,
        "task.completed",
        started.id,
      );
      child.stdout.emit("data", "out 1\n");
      await firstOutput;
      assert.equal(settled, false);
      assert.equal(updates.join(""), "out 1\n");
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
    },
  );

  it("builds a bounded head-tail result for large foreground output", async () => {
    const child = fakeChild();
    let spawned!: () => void;
    const didSpawn = new Promise<void>((resolve) => {
      spawned = resolve;
    });
    const { supervisor } = fakeSupervisor({ child, onSpawn: spawned });
    const { manager, storage, events } = await createManager(supervisor);
    const started = waitForTaskEvent(events, "task.started");
    const run = manager.runForegroundBashWithPromotion({
      command: "node noisy.js",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    await started;
    await didSpawn;
    child.stdout.emit(
      "data",
      Buffer.from(`BEGIN-${"x".repeat(64 * 1024)}-END`),
    );
    child.emitClose(0, null);

    const result = await run;

    assert.equal(result.kind, "completed_foreground");
    assert.match(result.result.content ?? "", /BEGIN-/);
    assert.match(
      result.result.content ?? "",
      /bytes omitted from inline result/,
    );
    const details = result.result.details as { fullOutputPath?: string };
    assert.ok(details.fullOutputPath);
    assert.match(await readFile(details.fullOutputPath, "utf8"), /-END/);
    assert.match(
      result.result.content ?? "",
      /use task_logs for retained diagnostics/i,
    );
  });

  it("captures output before delayed runtime identity resolves", async () => {
    const child = fakeChild();
    let resolveRuntime!: (runtime: ReturnType<typeof runtimeMetadata>) => void;
    const runtimeReady = new Promise<ReturnType<typeof runtimeMetadata>>(
      (resolve) => {
        resolveRuntime = resolve;
      },
    );
    let spawned!: () => void;
    const didSpawn = new Promise<void>((resolve) => {
      spawned = resolve;
    });
    const { supervisor } = fakeSupervisor({
      child,
      runtimeReady,
      onSpawn: spawned,
    });
    const { manager, storage } = await createManager(supervisor);

    const run = manager.runForegroundBashWithPromotion({
      command: "printf early",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    await didSpawn;
    child.stdout.emit("data", Buffer.from("early out\n"));
    child.stderr.emit("data", Buffer.from("early err\n"));
    child.emitClose(0, null);
    resolveRuntime(runtimeMetadata({ childPid: child.pid }));

    const result = await run;

    assert.equal(result.kind, "completed_foreground");
    assert.equal(result.result.stdout, "early out");
    assert.equal(result.result.stderr, "early err");
    assert.equal(result.result.content, "early out\nearly err\n");
  });

  it("waits for output streams to drain after process close", async () => {
    const child = fakeChild();
    const { supervisor } = fakeSupervisor({ child });
    const { manager, storage, events } = await createManager(supervisor);
    const started = waitForTaskEvent(events, "task.started");
    const run = manager.runForegroundBashWithPromotion({
      command: "printf buffered",
      cwd: storage.paths.home,
      projectId: "proj_test",
      conversationId: "conv_test",
      agentId: "agent_test",
      origin: { kind: "agent_tool", toolCallId: "tool_test" },
    });
    await started;
    let settled = false;
    void run.then(() => {
      settled = true;
    });

    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await Promise.resolve();
    assert.equal(settled, false);

    child.stdout.emit("data", Buffer.from("buffered out\n"));
    child.stdout.emit("end");
    child.stdout.emit("close");
    child.stderr.emit("end");
    child.stderr.emit("close");
    const result = await run;

    assert.equal(result.kind, "completed_foreground");
    assert.equal(result.result.stdout, "buffered out");
  });

  it(
    "force-kills the process tree when foreground bash is aborted",
    { timeout: 10_000 },
    async () => {
      const child = fakeChild();
      const { supervisor, terminateSignals } = fakeSupervisor({
        child,
        onTerminate(signal) {
          child.emitClose(null, signal);
        },
      });
      const { manager, storage, events } = await createManager(supervisor);
      const abort = new AbortController();
      const started = waitForTaskEvent(events, "task.started");
      const run = manager.runForegroundBashWithPromotion({
        command: "sleep forever",
        cwd: storage.paths.home,
        projectId: "proj_test",
        conversationId: "conv_test",
        agentId: "agent_test",
        origin: { kind: "agent_tool", toolCallId: "tool_test" },
        signal: abort.signal,
      });
      const task = await started;

      abort.abort();

      await assert.rejects(run, /aborted/i);
      assert.deepEqual(terminateSignals, ["SIGKILL"]);
      assert.throws(() => manager.getTask(task.id), /Task not found/);
    },
  );

  it("hydrates exited foreground bash tasks as visible interrupted tasks", async () => {
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
    assert.equal(hydrated.status, "interrupted");
    assert.equal(hydrated.visibility, "background");
    assert.equal(hydrated.notifications?.enabled, true);
    assert.equal(hydrated.notifications?.terminal, true);
    assert.equal(hydrated.completion?.inject, true);
  });
});
