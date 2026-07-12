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
      signal: async () => undefined,
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
    callbacks: () => callbacks,
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

test("process output is bounded, transient, and delegated to durable logs", async () => {
  const { service, events, callbacks } = fixture();
  await service.start({ cwd: "/workspace", command: "echo hello" });
  await callbacks()?.onOutput?.("stdout", "x".repeat(20_000));
  const output = events.find((event) => event.type === "task.output");
  assert.equal(output?.durability, "transient");
  assert.equal(
    (output?.data as { text: string } | undefined)?.text.length,
    16_384,
  );
});
