import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainEventIntent,
  TaskProcessCallbacks,
  TaskServicePorts,
} from "../src/index.js";
import { TaskService } from "../src/index.js";
import type { TaskRecord } from "@nervekit/contracts";

function fixture(
  options: {
    waitForExit?:
      | "timeout"
      | "unavailable"
      | { exitedAt: string; exitCode: number };
    readiness?: "ready" | "timeout" | "exited" | "unavailable";
  } = {},
) {
  const records = new Map<string, TaskRecord>();
  const events: DomainEventIntent[] = [];
  const signals: Array<string | undefined> = [];
  let callbacks: TaskProcessCallbacks | undefined;
  const ports: TaskServicePorts = {
    repository: {
      get: async (id) => records.get(id),
      list: async () => [...records.values()],
      save: async (task) => void records.set(task.id, structuredClone(task)),
      remove: async (id) => void records.delete(id),
    },
    process: {
      spawn: async (_input, nextCallbacks) => {
        callbacks = nextCallbacks;
        return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
      },
      signal: async (_task, cancelOptions) => {
        signals.push(cancelOptions.signal);
      },
      inspect: async () => "running",
      waitForExit: async () => options.waitForExit ?? "timeout",
    },
    logs: {
      query: async () => ({ events: [], nextCursor: 0 }),
      append: async () => undefined,
      remove: async () => undefined,
    },
    readiness: options.readiness
      ? {
          wait: async () =>
            options.readiness as NonNullable<typeof options.readiness>,
        }
      : undefined,
    events: { publish: async (event) => void events.push(event) },
    clock: { now: () => new Date("2026-07-11T00:00:00.000Z") },
    ids: { next: () => "task_contract" },
    workspaceRoot: "/workspace",
  };
  return {
    service: new TaskService(ports),
    records,
    events,
    signals,
    callbacks: () => callbacks,
  };
}

function servicePortsForRecords(
  records: Map<string, TaskRecord>,
  events: DomainEventIntent[],
  options: {
    save?: (task: TaskRecord) => Promise<void>;
    spawn?: TaskServicePorts["process"]["spawn"];
    inspect?: TaskServicePorts["process"]["inspect"];
    signal?: TaskServicePorts["process"]["signal"];
    readiness?: TaskServicePorts["readiness"];
    diagnostics?: TaskServicePorts["diagnostics"];
    timers?: TaskServicePorts["timers"];
  } = {},
): TaskServicePorts {
  return {
    repository: {
      get: async (id) => records.get(id),
      list: async () => [...records.values()],
      save:
        options.save ??
        (async (task) => void records.set(task.id, structuredClone(task))),
      remove: async (id) => void records.delete(id),
    },
    process: {
      spawn:
        options.spawn ??
        (async () => ({
          pid: 42,
          startedAt: "2026-07-11T00:00:00.000Z",
        })),
      signal: options.signal ?? (async () => undefined),
      inspect: options.inspect ?? (async () => "running"),
      waitForExit: async () => "timeout",
    },
    logs: {
      query: async () => ({ events: [], nextCursor: 0 }),
      append: async () => undefined,
      remove: async () => undefined,
    },
    readiness: options.readiness,
    events: { publish: async (event) => void events.push(event) },
    clock: { now: () => new Date("2026-07-11T00:00:00.000Z") },
    ids: { next: () => "task_contract" },
    diagnostics: options.diagnostics,
    timers: options.timers,
    workspaceRoot: "/workspace",
  };
}

test("cancellation is terminal only after process-exit evidence", async () => {
  const pending = fixture({ waitForExit: "timeout" });
  await pending.service.start({ cwd: "/workspace", command: "sleep 60" });
  const stopping = await pending.service.cancel("task_contract");
  assert.equal(stopping.status, "stopping");
  assert.equal(
    pending.events.some((event) => event.type === "task.cancelled"),
    false,
  );

  const exited = fixture({
    waitForExit: {
      exitedAt: "2026-07-11T00:00:01.000Z",
      exitCode: 0,
    },
  });
  await exited.service.start({ cwd: "/workspace", command: "sleep 60" });
  assert.equal(
    (await exited.service.cancel("task_contract")).status,
    "cancelled",
  );
});

test("hard cancellation escalates a task that is already stopping", async () => {
  const harness = fixture({ waitForExit: "timeout" });
  await harness.service.start({ cwd: "/workspace", command: "sleep 60" });
  await harness.service.cancel("task_contract");
  harness.signals.length = 0;

  const stopping = await harness.service.cancel("task_contract", {
    signal: "SIGKILL",
  });

  assert.equal(stopping.status, "stopping");
  assert.deepEqual(harness.signals, ["SIGKILL"]);
});

test("readiness timeout records failure without pretending process exit", async () => {
  const { service, records, events } = fixture({ readiness: "timeout" });
  await service.start({
    cwd: "/workspace",
    command: "pnpm dev",
    readyPattern: "ready",
    readyTimeoutMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(records.get("task_contract")?.status, "running");
  assert.equal(records.get("task_contract")?.readiness.outcome, "timeout");
  assert.equal(
    events.some((event) => event.type === "task.readiness_failed"),
    true,
  );
});

test("terminal callbacks are idempotent across repeated exit and cancellation races", async () => {
  const { service, events, callbacks, records } = fixture({
    waitForExit: {
      exitedAt: "2026-07-11T00:00:01.000Z",
      exitCode: 0,
    },
  });
  await service.start({ cwd: "/workspace", command: "sleep 60" });
  const cancellation = service.cancel("task_contract");
  await callbacks()?.onExit?.({
    exitedAt: "2026-07-11T00:00:01.000Z",
    exitCode: 0,
  });
  await callbacks()?.onExit?.({
    exitedAt: "2026-07-11T00:00:02.000Z",
    exitCode: 1,
  });
  await cancellation;
  assert.equal(records.get("task_contract")?.status, "cancelled");
  assert.equal(
    events.filter((event) => event.type === "task.cancelled").length,
    1,
  );
  assert.equal(
    events.some((event) => event.type === "task.completed"),
    false,
  );
});

test("workspace containment normalizes POSIX and Windows paths", async () => {
  const { assertWorkspacePath } = await import("../src/index.js");
  assert.doesNotThrow(() =>
    assertWorkspacePath("/workspace/a/..", "/workspace"),
  );
  assert.throws(() => assertWorkspacePath("/workspace-other", "/workspace"));
  assert.doesNotThrow(() =>
    assertWorkspacePath("C:\\workspace\\project", "C:\\workspace"),
  );
  assert.throws(() =>
    assertWorkspacePath("C:\\workspace-other", "C:\\workspace"),
  );
});

test("launch environments are not reported persisted without storage", async () => {
  const { service, records } = fixture();
  await service.start({
    cwd: "/workspace",
    command: "echo env",
    env: { TOKEN: "secret" },
  });
  assert.deepEqual(records.get("task_contract")?.envInfo, {
    keys: ["TOKEN"],
    persisted: false,
    redacted: true,
  });
  await assert.rejects(
    service.restart("task_contract"),
    /environment was not persisted/,
  );
});

test("live processes without a supervision handle reconcile as orphaned", async () => {
  const { service, records, events } = fixture();
  await service.start({ cwd: "/workspace", command: "sleep 60" });
  const task = records.get("task_contract");
  assert.ok(task);

  const ports = servicePortsForRecords(records, events, {
    inspect: async () => "unsupervised_running",
  });
  const recovered = new TaskService(ports);
  const orphaned = await recovered.reconcileOrphans();
  assert.equal(orphaned.length, 1);
  assert.equal(records.get("task_contract")?.status, "orphaned");
});

test("rejected transitions do not break per-task serialization", async () => {
  const records = new Map<string, TaskRecord>();
  const events: DomainEventIntent[] = [];
  let callbacks: TaskProcessCallbacks | undefined;
  let rejectStoppingSave = true;
  let activeSaves = 0;
  let maxActiveSaves = 0;
  const ports = servicePortsForRecords(records, events, {
    spawn: async (_input, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
    },
    save: async (task) => {
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSaves -= 1;
      if (task.status === "stopping" && rejectStoppingSave) {
        rejectStoppingSave = false;
        throw new Error("injected transition failure");
      }
      records.set(task.id, structuredClone(task));
    },
  });
  const service = new TaskService(ports);
  await service.start({ cwd: "/workspace", command: "sleep 60" });
  const failedCancel = service.cancel("task_contract");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const exit = callbacks?.onExit?.({
    exitCode: 0,
    exitedAt: "2026-07-11T00:00:01.000Z",
  });
  await assert.rejects(failedCancel, /injected transition failure/);
  await exit;
  assert.equal(maxActiveSaves, 1);
  assert.equal(records.get("task_contract")?.status, "cancelled");
});

test("watcher failures are observed and converted to durable state", async () => {
  const records = new Map<string, TaskRecord>();
  const events: DomainEventIntent[] = [];
  const diagnostics: string[] = [];
  const readiness = new TaskService(
    servicePortsForRecords(records, events, {
      readiness: { wait: async () => Promise.reject(new Error("bad regex")) },
      diagnostics: {
        debug: () => undefined,
        warn: () => undefined,
        error: (_message, data) => diagnostics.push(String(data?.kind)),
      },
    }),
  );
  await readiness.start({
    cwd: "/workspace",
    command: "dev",
    readyPattern: "[",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(records.get("task_contract")?.readiness.outcome, "unavailable");
  assert.ok(diagnostics.includes("readiness"));
  assert.ok(events.some((event) => event.type === "task.readiness_failed"));
});

test("runtime-timeout watcher adapter failures are observed", async () => {
  const records = new Map<string, TaskRecord>();
  const events: DomainEventIntent[] = [];
  const diagnostics: string[] = [];
  const ports = servicePortsForRecords(records, events, {
    diagnostics: {
      debug: () => undefined,
      warn: () => undefined,
      error: (_message, data) => diagnostics.push(String(data?.kind)),
    },
    timers: { sleep: async () => undefined },
    signal: async () => {
      throw new Error("signal adapter failed");
    },
  });
  const service = new TaskService(ports);
  await service.start({ cwd: "/workspace", command: "sleep 60", timeoutMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(diagnostics.includes("runtime_timeout"));
  assert.match(
    records.get("task_contract")?.error ?? "",
    /signal adapter failed/,
  );
});

test("terminal persistence failures remain visible and retryable", async () => {
  const records = new Map<string, TaskRecord>();
  const events: DomainEventIntent[] = [];
  let callbacks: TaskProcessCallbacks | undefined;
  let failTerminalSave = true;
  const service = new TaskService(
    servicePortsForRecords(records, events, {
      spawn: async (_input, nextCallbacks) => {
        callbacks = nextCallbacks;
        return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
      },
      save: async (task) => {
        if (task.status === "completed" && failTerminalSave) {
          failTerminalSave = false;
          throw new Error("disk unavailable");
        }
        records.set(task.id, structuredClone(task));
      },
    }),
  );
  await service.start({ cwd: "/workspace", command: "true" });
  await callbacks?.onExit?.({
    exitCode: 0,
    exitedAt: "2026-07-11T00:00:01.000Z",
  });
  assert.deepEqual(service.pendingTerminalFailureIds(), ["task_contract"]);
  assert.equal(records.get("task_contract")?.status, "running");
  assert.equal(
    (await service.retryTerminalFailure("task_contract")).status,
    "completed",
  );
  assert.deepEqual(service.pendingTerminalFailureIds(), []);
});

test("process output is bounded, ephemeral, and delegated to retained logs", async () => {
  const { service, events, callbacks } = fixture();
  await service.start({ cwd: "/workspace", command: "echo hello" });
  await callbacks()?.onOutput?.("stdout", "x".repeat(20_000));
  const output = events.find((event) => event.type === "task.output");
  assert.equal(output?.delivery, "ephemeral");
  assert.equal(
    (output?.data as { text: string } | undefined)?.text.length,
    16_384,
  );
});
