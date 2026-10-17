import assert from "node:assert/strict";
import test from "node:test";
import type { DomainEventIntent } from "../../../src/core/ports/domain-events.js";
import {
  LaunchService,
  type LaunchProcessCallbacks,
  type LaunchServicePorts,
} from "../../../src/domains/launches/application/launch.service.js";
import type { LaunchRecord } from "@nervekit/contracts/launches";

function createService(ports: LaunchServicePorts): LaunchService {
  const launches = new Map<string, LaunchRecord>();
  const save = ports.repository.save;
  const remove = ports.repository.remove;
  ports.repository.save = async (launch) => {
    await save(launch);
    launches.set(launch.id, launch);
  };
  ports.repository.remove = async (id) => {
    await remove(id);
    launches.delete(id);
  };
  return new LaunchService({
    ports,
    launches,
    managed: new Map(),
    repository: {} as never,
    logs: {} as never,
    supervisor: { inspectRuntimeListeningPorts: async () => [] } as never,
  });
}

function fixture(
  options: {
    waitForExit?:
      | "timeout"
      | "unavailable"
      | { exitedAt: string; exitCode: number };
    readiness?: "ready" | "timeout" | "exited" | "unavailable";
  } = {},
) {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  const signals: Array<string | undefined> = [];
  let callbacks: LaunchProcessCallbacks | undefined;
  const ports: LaunchServicePorts = {
    repository: {
      get: async (id) => records.get(id),
      list: async () => [...records.values()],
      save: async (launch) =>
        void records.set(launch.id, structuredClone(launch)),
      remove: async (id) => void records.delete(id),
    },
    process: {
      spawn: async (_input, nextCallbacks) => {
        callbacks = nextCallbacks;
        return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
      },
      signal: async (_launch, cancelOptions) => {
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
    ids: { next: () => "launch_contract" },
  };
  return {
    service: createService(ports),
    records,
    events,
    signals,
    callbacks: () => callbacks,
  };
}

function servicePortsForRecords(
  records: Map<string, LaunchRecord>,
  events: DomainEventIntent[],
  options: {
    save?: (launch: LaunchRecord) => Promise<void>;
    spawn?: LaunchServicePorts["process"]["spawn"];
    inspect?: LaunchServicePorts["process"]["inspect"];
    signal?: LaunchServicePorts["process"]["signal"];
    readiness?: LaunchServicePorts["readiness"];
    diagnostics?: LaunchServicePorts["diagnostics"];
    timers?: LaunchServicePorts["timers"];
    clock?: LaunchServicePorts["clock"];
    definitionPortGuard?: LaunchServicePorts["definitionPortGuard"];
  } = {},
): LaunchServicePorts {
  return {
    repository: {
      get: async (id) => records.get(id),
      list: async () => [...records.values()],
      save:
        options.save ??
        (async (launch) =>
          void records.set(launch.id, structuredClone(launch))),
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
    clock:
      options.clock ??
      ({ now: () => new Date("2026-07-11T00:00:00.000Z") } as const),
    ids: { next: () => "launch_contract" },
    diagnostics: options.diagnostics,
    timers: options.timers,
    definitionPortGuard: options.definitionPortGuard,
  };
}

test("definition launch returns a port conflict and starts only after confirmed release", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  const listener = {
    protocol: "tcp" as const,
    address: "127.0.0.1",
    port: 3000,
    pid: 99,
    identity: "linux:123",
    processName: "node",
  };
  const approvals: unknown[] = [];
  const ports = servicePortsForRecords(records, events, {
    definitionPortGuard: {
      prepare: async (_port, approved) => {
        approvals.push(approved);
        return approved ? [] : [listener];
      },
    },
  });
  const service = createService(ports);
  const request = {
    projectId: "proj_one",
    definitionId: "launchdef_web",
    definitionRunPolicy: "single" as const,
    definitionPort: 3000,
    cwd: "/workspace",
    command: "pnpm dev",
  };

  assert.deepEqual(await service.launchDefinition(request), {
    disposition: "port_conflict",
    conflict: { port: 3000, listeners: [listener] },
  });
  assert.equal(records.size, 0);

  const launched = await service.launchDefinition({
    ...request,
    terminateListeners: [listener],
  });
  assert.equal(launched.disposition, "started");
  assert.equal(records.size, 1);
  assert.deepEqual(approvals, [undefined, [listener]]);
});

test("runtime timeout includes process startup and identity delay", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  const sleeps: number[] = [];
  let elapsedMs = 0;
  const epoch = Date.parse("2026-07-11T00:00:00.000Z");
  const ports = servicePortsForRecords(records, events, {
    spawn: async () => {
      elapsedMs = 600;
      return { pid: 42, startedAt: new Date(epoch).toISOString() };
    },
    clock: { now: () => new Date(epoch + elapsedMs) },
    timers: {
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        await new Promise<void>(() => undefined);
      },
    },
  });

  await createService(ports).start({
    cwd: "/workspace",
    command: "sleep 60",
    timeoutMs: 1_000,
  });
  await Promise.resolve();

  assert.deepEqual(sleeps, [400]);
});

test("a pruned launch makes its delayed timeout watcher exit quietly", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  const diagnostics: string[] = [];
  let callbacks: LaunchProcessCallbacks | undefined;
  let releaseTimeout!: () => void;
  const timeout = new Promise<void>((resolve) => {
    releaseTimeout = resolve;
  });
  const ports = servicePortsForRecords(records, events, {
    spawn: async (_input, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
    },
    diagnostics: {
      error: (_message, context) => diagnostics.push(String(context?.kind)),
    },
    timers: { sleep: async () => timeout },
  });
  const service = createService(ports);
  await service.start({
    cwd: "/workspace",
    command: "sleep 60",
    timeoutMs: 10,
  });
  await callbacks?.onExit?.({
    exitedAt: "2026-07-11T00:00:01.000Z",
    exitCode: 0,
  });
  assert.deepEqual(await service.prune(), ["launch_contract"]);

  releaseTimeout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(diagnostics, []);
});

test("launch deletion waits for an in-flight terminal transition", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  let callbacks: LaunchProcessCallbacks | undefined;
  let releaseTerminalSave!: () => void;
  const terminalSave = new Promise<void>((resolve) => {
    releaseTerminalSave = resolve;
  });
  const ports = servicePortsForRecords(records, events, {
    spawn: async (_input, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
    },
    save: async (launch) => {
      if (launch.status === "completed") await terminalSave;
      records.set(launch.id, structuredClone(launch));
    },
  });
  const service = createService(ports);
  await service.start({ cwd: "/workspace", command: "true" });
  const exiting = callbacks?.onExit?.({
    exitedAt: "2026-07-11T00:00:01.000Z",
    exitCode: 0,
  });
  await Promise.resolve();
  const deleting = service.delete("launch_contract");
  await Promise.resolve();
  assert.equal(records.has("launch_contract"), true);

  releaseTerminalSave();
  await exiting;
  await deleting;
  assert.equal(records.has("launch_contract"), false);
  assert.deepEqual(
    events
      .filter((event) =>
        ["launch.completed", "launch.removed"].includes(event.type),
      )
      .map((event) => event.type),
    ["launch.completed", "launch.removed"],
  );
});

test("cancellation is terminal only after process-exit evidence", async () => {
  const pending = fixture({ waitForExit: "timeout" });
  await pending.service.start({ cwd: "/workspace", command: "sleep 60" });
  const stopping = await pending.service.cancel("launch_contract");
  assert.equal(stopping.status, "stopping");
  assert.equal(
    pending.events.some((event) => event.type === "launch.cancelled"),
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
    (await exited.service.cancel("launch_contract")).status,
    "cancelled",
  );
});

test("hard cancellation escalates a launch that is already stopping", async () => {
  const harness = fixture({ waitForExit: "timeout" });
  await harness.service.start({ cwd: "/workspace", command: "sleep 60" });
  await harness.service.cancel("launch_contract");
  harness.signals.length = 0;

  const stopping = await harness.service.cancel("launch_contract", {
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
  assert.equal(records.get("launch_contract")?.status, "running");
  assert.equal(records.get("launch_contract")?.readiness.outcome, "timeout");
  assert.equal(
    events.some((event) => event.type === "launch.readiness_failed"),
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
  const cancellation = service.cancel("launch_contract");
  await callbacks()?.onExit?.({
    exitedAt: "2026-07-11T00:00:01.000Z",
    exitCode: 0,
  });
  await callbacks()?.onExit?.({
    exitedAt: "2026-07-11T00:00:02.000Z",
    exitCode: 1,
  });
  await cancellation;
  assert.equal(records.get("launch_contract")?.status, "cancelled");
  assert.equal(
    events.filter((event) => event.type === "launch.cancelled").length,
    1,
  );
  assert.equal(
    events.some((event) => event.type === "launch.completed"),
    false,
  );
});

test("launch working directories normalize absolute and project-relative paths", async () => {
  const { resolveLaunchWorkingDirectory } =
    await import("../../../src/domains/launches/model/launch-working-directory.js");
  assert.equal(resolveLaunchWorkingDirectory("/workspace/a/.."), "/workspace");
  assert.equal(
    resolveLaunchWorkingDirectory("apps/web/..", "/workspace/project"),
    "/workspace/project/apps",
  );
  assert.equal(
    resolveLaunchWorkingDirectory("../shared", "/workspace/project"),
    "/workspace/shared",
  );
  assert.equal(
    resolveLaunchWorkingDirectory("C:\\workspace\\project\\.."),
    "C:\\workspace",
  );
  assert.equal(
    resolveLaunchWorkingDirectory("apps\\web\\..", "C:\\workspace\\project"),
    "C:\\workspace\\project\\apps",
  );
  assert.equal(
    resolveLaunchWorkingDirectory("\\\\server\\share\\project"),
    "\\\\server\\share\\project",
  );
  assert.throws(
    () => resolveLaunchWorkingDirectory("workspace/project"),
    /absolute path/,
  );
  assert.throws(
    () => resolveLaunchWorkingDirectory("workspace/project", "relative/base"),
    /base must be an absolute path/,
  );
});

test("launch environments are not reported persisted without storage", async () => {
  const { service, records } = fixture();
  await service.start({
    cwd: "/workspace",
    command: "echo env",
    env: { TOKEN: "secret" },
  });
  assert.deepEqual(records.get("launch_contract")?.envInfo, {
    keys: ["TOKEN"],
    persisted: false,
    redacted: true,
  });
  await assert.rejects(
    service.restart("launch_contract"),
    /environment was not persisted/,
  );
});

test("the merged launch service lists, associates, and shuts down user launches", async () => {
  const { service, events, signals } = fixture();
  const launch = await service.start({ cwd: "/workspace", command: "server" });
  assert.deepEqual(
    service.listLaunches().map(({ id }) => id),
    [launch.id],
  );
  await service.associateDefinition(launch.id, "launchdef_server");
  assert.equal(
    (await service.require(launch.id)).definitionId,
    "launchdef_server",
  );
  assert.equal(events.at(-1)?.type, "launch.updated");
  assert.equal(
    (events.at(-1)?.data as { launch: LaunchRecord }).launch.id,
    launch.id,
  );
  await service.shutdown();
  assert.deepEqual(signals, ["SIGKILL"]);
  await assert.rejects(
    service.start({ cwd: "/workspace", command: "server" }),
    /shutting down/,
  );
});

test("large process output is losslessly framed without notifying tool observers", async () => {
  const { service, events, callbacks } = fixture();
  const observed: string[] = [];
  await service.start({
    cwd: "/workspace",
    command: "noisy-command",
    onOutput: async (update) => void observed.push(update.chunk),
  });
  const input = `${"x".repeat(70_000)}🙂${"界".repeat(2_000)}`;

  await callbacks()?.onOutput?.("stdout", input);

  const outputEvents = events.filter((event) => event.type === "launch.output");
  const emitted = outputEvents.map(
    (event) => (event.data as { text: string }).text,
  );
  assert.equal(emitted.join(""), input);
  assert.deepEqual(observed, []);
  assert.ok(emitted.every((chunk) => Buffer.byteLength(chunk) <= 8 * 1024));
});

test("rejected transitions do not break per-launch serialization", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  let callbacks: LaunchProcessCallbacks | undefined;
  let rejectStoppingSave = true;
  let activeSaves = 0;
  let maxActiveSaves = 0;
  const ports = servicePortsForRecords(records, events, {
    spawn: async (_input, nextCallbacks) => {
      callbacks = nextCallbacks;
      return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
    },
    save: async (launch) => {
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSaves -= 1;
      if (launch.status === "stopping" && rejectStoppingSave) {
        rejectStoppingSave = false;
        throw new Error("injected transition failure");
      }
      records.set(launch.id, structuredClone(launch));
    },
  });
  const service = createService(ports);
  await service.start({ cwd: "/workspace", command: "sleep 60" });
  const failedCancel = service.cancel("launch_contract");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const exit = callbacks?.onExit?.({
    exitCode: 0,
    exitedAt: "2026-07-11T00:00:01.000Z",
  });
  await assert.rejects(failedCancel, /injected transition failure/);
  await exit;
  assert.equal(maxActiveSaves, 1);
  assert.equal(records.get("launch_contract")?.status, "cancelled");
});

test("watcher failures are observed and converted to durable state", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  const diagnostics: string[] = [];
  const readiness = createService(
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
  assert.equal(
    records.get("launch_contract")?.readiness.outcome,
    "unavailable",
  );
  assert.ok(diagnostics.includes("readiness"));
  assert.ok(events.some((event) => event.type === "launch.readiness_failed"));
});

test("runtime-timeout watcher adapter failures are observed", async () => {
  const records = new Map<string, LaunchRecord>();
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
  const service = createService(ports);
  await service.start({ cwd: "/workspace", command: "sleep 60", timeoutMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(diagnostics.includes("runtime_timeout"));
  assert.match(
    records.get("launch_contract")?.error ?? "",
    /signal adapter failed/,
  );
});

test("terminal persistence failures remain visible and retryable", async () => {
  const records = new Map<string, LaunchRecord>();
  const events: DomainEventIntent[] = [];
  let callbacks: LaunchProcessCallbacks | undefined;
  let failTerminalSave = true;
  const service = createService(
    servicePortsForRecords(records, events, {
      spawn: async (_input, nextCallbacks) => {
        callbacks = nextCallbacks;
        return { pid: 42, startedAt: "2026-07-11T00:00:00.000Z" };
      },
      save: async (launch) => {
        if (launch.status === "completed" && failTerminalSave) {
          failTerminalSave = false;
          throw new Error("disk unavailable");
        }
        records.set(launch.id, structuredClone(launch));
      },
    }),
  );
  await service.start({ cwd: "/workspace", command: "true" });
  await callbacks?.onExit?.({
    exitCode: 0,
    exitedAt: "2026-07-11T00:00:01.000Z",
  });
  assert.deepEqual(service.pendingTerminalFailureIds(), ["launch_contract"]);
  assert.equal(records.get("launch_contract")?.status, "running");
  assert.equal(
    (await service.retryTerminalFailure("launch_contract")).status,
    "completed",
  );
  assert.deepEqual(service.pendingTerminalFailureIds(), []);
});

test("process output is bounded, ephemeral, and delegated to retained logs", async () => {
  const { service, events, callbacks } = fixture();
  await service.start({ cwd: "/workspace", command: "echo hello" });
  await callbacks()?.onOutput?.("stdout", "x".repeat(20_000));
  const output = events.filter((event) => event.type === "launch.output");
  assert.ok(output.every((event) => event.delivery === "ephemeral"));
  const chunks = output.map((event) => (event.data as { text: string }).text);
  assert.equal(chunks.join(""), "x".repeat(20_000));
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 8 * 1024));
});

test("single definition identity is project-qualified, including pending starts", async () => {
  const records = new Map<string, LaunchRecord>();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let portChecks = 0;
  let bothChecking!: () => void;
  const checking = new Promise<void>((resolve) => {
    bothChecking = resolve;
  });
  const ports = servicePortsForRecords(records, [], {
    definitionPortGuard: {
      prepare: async () => {
        if (++portChecks === 2) bothChecking();
        await blocked;
        return [];
      },
    },
  });
  let nextId = 0;
  ports.ids = { next: () => `launch_${++nextId}` };
  const service = createService(ports);
  const request = {
    definitionId: "launchdef_copied",
    definitionRunPolicy: "single" as const,
    definitionPort: 3000,
    cwd: "/external/shared-cwd",
    command: "pnpm dev",
  };
  const first = service.launchDefinition({ ...request, projectId: "proj_one" });
  const second = service.launchDefinition({
    ...request,
    projectId: "proj_copy",
  });
  await checking;
  release();
  const [one, copy] = await Promise.all([first, second]);
  assert.equal(one.disposition, "started");
  assert.equal(copy.disposition, "started");
  assert.equal(records.size, 2);
  for (const projectId of ["proj_one", "proj_copy"]) {
    const focused = await service.launchDefinition({ ...request, projectId });
    assert.equal(focused.disposition, "focused_existing");
    if (focused.disposition !== "port_conflict")
      assert.equal(focused.launch.projectId, projectId);
  }
});

test("pending starts for the same project definition coalesce", async () => {
  const records = new Map<string, LaunchRecord>();
  let release!: () => void;
  let checking!: () => void;
  const checked = new Promise<void>((resolve) => {
    checking = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let checks = 0;
  const service = createService(
    servicePortsForRecords(records, [], {
      definitionPortGuard: {
        prepare: async () => {
          checks++;
          checking();
          await blocked;
          return [];
        },
      },
    }),
  );
  const request = {
    projectId: "proj_one",
    definitionId: "launchdef_one",
    definitionRunPolicy: "single" as const,
    definitionPort: 3000,
    cwd: "/project",
    command: "pnpm dev",
  };
  const first = service.launchDefinition(request);
  await checked;
  const second = service.launchDefinition(request);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.disposition),
    ["started", "focused_existing"],
  );
  assert.equal(checks, 1);
  assert.equal(records.size, 1);
});

test("restart and output retain the run's project identity with an external cwd", async () => {
  const records = new Map<string, LaunchRecord>();
  const ports = servicePortsForRecords(records, []);
  let nextId = 0;
  ports.ids = { next: () => `launch_${++nextId}` };
  const queried: LaunchRecord[] = [];
  ports.logs.query = async (launch) => {
    queried.push(launch);
    return { events: [], nextCursor: 0 };
  };
  const service = createService(ports);
  const original = await service.start({
    definitionId: "launchdef_copied",
    projectId: "proj_copy",
    command: "original command",
    cwd: "/external",
  });
  records.set(original.id, { ...original, status: "completed" });
  const restarted = await service.restart(original.id);
  assert.equal(restarted.projectId, "proj_copy");
  assert.equal(restarted.definitionId, "launchdef_copied");
  assert.equal(restarted.cwd, "/external");
  assert.equal(restarted.command, "original command");
  await service.logs(restarted.id, {});
  assert.equal(queried[0]?.projectId, "proj_copy");
  assert.equal(queried[0]?.id, restarted.id);
});
