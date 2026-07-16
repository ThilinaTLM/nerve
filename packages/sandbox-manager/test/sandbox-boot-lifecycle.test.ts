import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { buildEventBatch, createMessageFactory } from "@nervekit/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ManagerState } from "../src/app/manager-state.js";
import { SandboxLifecycleWatchdog } from "../src/lifecycle/lifecycle-watchdog.js";
import { transitionSandboxLifecycle } from "../src/lifecycle/lifecycle-state.js";
import { refreshSandboxObservedState } from "../src/lifecycle/reconciler.js";
import type { ContainerRuntimeDriver } from "../src/drivers/container-runtime-driver.js";
import type { StoredSandboxEvent } from "../src/state/event-store.js";
import { SandboxWsServer } from "../src/protocol/sandbox-ws-server.js";

const agentCapabilities = [
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.runtime.v1",
  "sandbox.events.v1",
  "sandbox.snapshots.v1",
];

function baseRecord(
  overrides: Partial<ManagedSandboxRecord> = {},
): ManagedSandboxRecord {
  return {
    sandboxId: "sbx_test",
    instanceId: "instance_test",
    backend: "docker",
    image: { reference: "img", sandboxSpec: "v1" },
    desiredState: "running",
    observedState: "running",
    lifecycleState: "container_started",
    lifecycleUpdatedAt: new Date().toISOString(),
    workspaceRef: { kind: "bind", source: "/tmp/w", target: "/workspace" },
    stateRef: { kind: "bind", source: "/tmp/s", target: "/state" },
    controller: { url: "ws://localhost", token: "token" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as ManagedSandboxRecord;
}

type TestState = {
  state: ManagerState;
  records: Map<string, ManagedSandboxRecord>;
  sessions: Map<string, Record<string, unknown>>;
};

function createTestState(record: ManagedSandboxRecord): TestState {
  const records = new Map<string, ManagedSandboxRecord>([
    [record.sandboxId, record],
  ]);
  const sessions = new Map<string, Record<string, unknown>>();
  const eventsByStore = new Map<string, StoredSandboxEvent[]>();
  const logger = {
    child: () => logger,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const state = {
    sandboxes: {
      get: async (id: string) => records.get(id),
      put: async (next: ManagedSandboxRecord) => {
        records.set(next.sandboxId, next);
      },
      list: async () => [...records.values()],
    },
    sessions: {
      get: async (id: string) => sessions.get(id),
      put: async (next: { sandboxId: string }) => {
        sessions.set(next.sandboxId, next as Record<string, unknown>);
      },
    },
    events: {
      list: async (storeId: string) => eventsByStore.get(storeId) ?? [],
      append: async (event: StoredSandboxEvent) => {
        const bucket = eventsByStore.get(event.sandboxId) ?? [];
        bucket.push(event);
        eventsByStore.set(event.sandboxId, bucket);
        return true;
      },
    },
    eventBus: { publish: () => undefined },
    activity: undefined,
    config: { reconnectTimeoutMs: 360_000 },
    logger,
  } as unknown as ManagerState;
  return { state, records, sessions };
}

async function withAgentSession(
  test: TestState,
  run: (helpers: {
    send: (message: unknown) => void;
    nextMessage: () => Promise<{ kind: string; data: Record<string, unknown> }>;
    messages: ReturnType<typeof createMessageFactory>;
  }) => Promise<void>,
): Promise<void> {
  const controller = new SandboxWsServer(test.state);
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  sockets.on("connection", (socket) => {
    void controller.acceptAgentConnection("sbx_test", socket);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const inbox: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const waiters: Array<
    (value: { kind: string; data: Record<string, unknown> }) => void
  > = [];
  socket.on("message", (raw) => {
    const parsed = JSON.parse(String(raw)) as {
      kind: string;
      data: Record<string, unknown>;
    };
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else inbox.push(parsed);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const messages = createMessageFactory({
    source: {
      role: "sandbox_agent",
      id: "sbx_test",
      instanceId: "instance_test",
    },
    target: { role: "sandbox_manager", id: "sandbox-manager" },
  });
  try {
    await run({
      send: (message) => socket.send(JSON.stringify(message)),
      nextMessage: () =>
        inbox.length > 0
          ? Promise.resolve(
              inbox.shift() as { kind: string; data: Record<string, unknown> },
            )
          : new Promise((resolve) => waiters.push(resolve)),
      messages,
    });
  } finally {
    socket.close();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 3_000)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a booting ready frame connects the daemon and live events drive lifecycle to ready", async () => {
  const context = createTestState(baseRecord());
  await withAgentSession(context, async ({ send, nextMessage, messages }) => {
    send(
      messages("hello", {
        requestedVersion: 1,
        capabilities: agentCapabilities,
        requiredCapabilities: agentCapabilities,
        encodings: ["json"],
        resume: { streams: [{ stream: "sandbox:sbx_test", processedSeq: 0 }] },
      }),
    );
    const welcome = await nextMessage();
    assert.equal(welcome.kind, "welcome");
    const sessionId = welcome.data.sessionId as string;

    send(messages("ready", { sessionId, status: "booting" }));
    await waitFor(
      () =>
        context.records.get("sbx_test")?.lifecycleState === "daemon_connected",
      "daemon_connected",
    );
    assert.equal(context.sessions.get("sbx_test")?.agentStatus, "booting");
    assert.equal(context.sessions.get("sbx_test")?.readyAt, undefined);

    const now = new Date().toISOString();
    send(
      messages("event.batch", {
        ...buildEventBatch(
          [
            {
              id: "evt_1",
              seq: 1,
              type: "sandbox.startup.stage.started",
              ts: now,
              durability: "durable",
              data: {
                sandboxId: "sbx_test",
                instanceId: "instance_test",
                stage: "preflight",
                attempt: 1,
                startedAt: now,
              },
            },
          ],
          {
            stream: "sandbox:sbx_test",
            previousDurableSeq: 0,
            reason: "live",
          },
        ),
      }),
    );
    await waitFor(
      () => context.records.get("sbx_test")?.lifecycleState === "booting",
      "booting",
    );

    send(
      messages("event.batch", {
        ...buildEventBatch(
          [
            {
              id: "evt_2",
              seq: 2,
              type: "sandbox.ready",
              ts: now,
              durability: "durable",
              data: {
                sandboxId: "sbx_test",
                instanceId: "instance_test",
                status: "ready",
                readyAt: now,
                recovered: false,
                daemonStatus: "ready",
                cursor: { streams: [] },
              },
            },
          ],
          {
            stream: "sandbox:sbx_test",
            previousDurableSeq: 1,
            reason: "live",
          },
        ),
      }),
    );
    await waitFor(
      () => context.records.get("sbx_test")?.lifecycleState === "ready",
      "ready",
    );
    assert.equal(context.sessions.get("sbx_test")?.agentStatus, "ready");
    assert.equal(context.sessions.get("sbx_test")?.readyAt, now);
  });
});

test("a failed startup stage records the stage error on the sandbox record", async () => {
  const context = createTestState(baseRecord());
  await withAgentSession(context, async ({ send, nextMessage, messages }) => {
    send(
      messages("hello", {
        requestedVersion: 1,
        capabilities: agentCapabilities,
        requiredCapabilities: agentCapabilities,
        encodings: ["json"],
        resume: { streams: [{ stream: "sandbox:sbx_test", processedSeq: 0 }] },
      }),
    );
    const welcome = await nextMessage();
    const sessionId = welcome.data.sessionId as string;
    send(messages("ready", { sessionId, status: "booting" }));
    await waitFor(
      () =>
        context.records.get("sbx_test")?.lifecycleState === "daemon_connected",
      "daemon_connected",
    );

    const now = new Date().toISOString();
    send(
      messages("event.batch", {
        ...buildEventBatch(
          [
            {
              id: "evt_1",
              seq: 1,
              type: "sandbox.startup.stage.completed",
              ts: now,
              durability: "durable",
              data: {
                sandboxId: "sbx_test",
                instanceId: "instance_test",
                stage: "models",
                attempt: 1,
                status: "failed",
                startedAt: now,
                completedAt: now,
                durationMs: 10,
                error: { code: "MODEL_RESOLVE", message: "no provider" },
              },
            },
          ],
          {
            stream: "sandbox:sbx_test",
            previousDurableSeq: 0,
            reason: "live",
          },
        ),
      }),
    );
    await waitFor(
      () =>
        context.records.get("sbx_test")?.lastError?.code ===
        "STARTUP_STAGE_FAILED",
      "startup stage failure",
    );
    assert.match(
      context.records.get("sbx_test")?.lastError?.message ?? "",
      /models: no provider/,
    );
  });
});

test("a ready frame without status keeps the legacy immediate-ready behavior", async () => {
  const context = createTestState(baseRecord());
  await withAgentSession(context, async ({ send, nextMessage, messages }) => {
    send(
      messages("hello", {
        requestedVersion: 1,
        capabilities: agentCapabilities,
        requiredCapabilities: agentCapabilities,
        encodings: ["json"],
        resume: { streams: [{ stream: "sandbox:sbx_test", processedSeq: 0 }] },
      }),
    );
    const welcome = await nextMessage();
    send(messages("ready", { sessionId: welcome.data.sessionId as string }));
    await waitFor(
      () => context.records.get("sbx_test")?.lifecycleState === "ready",
      "ready",
    );
    assert.equal(context.sessions.get("sbx_test")?.agentStatus, "ready");
  });
});

test("illegal lifecycle transitions are ignored without force", async () => {
  const context = createTestState(baseRecord({ lifecycleState: "ready" }));
  const transitionContext = {
    store: context.state.sandboxes,
    recordEvent: () => undefined,
  };
  const unchanged = await transitionSandboxLifecycle(
    transitionContext,
    "sbx_test",
    "container_started",
  );
  assert.equal(unchanged.lifecycleState, "ready");

  const reconnecting = await transitionSandboxLifecycle(
    transitionContext,
    "sbx_test",
    "reconnecting",
  );
  assert.equal(reconnecting.lifecycleState, "reconnecting");

  const forced = await transitionSandboxLifecycle(
    transitionContext,
    "sbx_test",
    "container_started",
    { force: true },
  );
  assert.equal(forced.lifecycleState, "container_started");
});

test("the watchdog fails a sandbox stuck in reconnecting past the timeout", async () => {
  const stale = new Date(Date.now() - 400_000).toISOString();
  const context = createTestState(
    baseRecord({ lifecycleState: "reconnecting", lifecycleUpdatedAt: stale }),
  );
  context.sessions.set("sbx_test", {
    sandboxId: "sbx_test",
    sessionId: "sess_1",
    state: "disconnected",
    updatedAt: stale,
    disconnectedAt: stale,
  });
  const watchdog = new SandboxLifecycleWatchdog(context.state);
  await watchdog.check();
  const record = context.records.get("sbx_test");
  assert.equal(record?.lifecycleState, "failed");
  assert.equal(record?.lastError?.code, "RECONNECT_TIMEOUT");
});

test("the watchdog leaves a recently disconnected sandbox reconnecting", async () => {
  const recent = new Date(Date.now() - 5_000).toISOString();
  const context = createTestState(
    baseRecord({ lifecycleState: "reconnecting", lifecycleUpdatedAt: recent }),
  );
  const watchdog = new SandboxLifecycleWatchdog(context.state);
  await watchdog.check();
  assert.equal(context.records.get("sbx_test")?.lifecycleState, "reconnecting");
});

test("an agent self-exit (code 22) settles the sandbox as stopped", async () => {
  const context = createTestState(
    baseRecord({
      lifecycleState: "reconnecting",
      containerRef: { id: "ctr_1", runtime: "docker" },
    }),
  );
  const driver = {
    inspect: async () => ({
      state: "exited" as const,
      exitCode: 22,
      finishedAt: new Date().toISOString(),
    }),
  } as unknown as ContainerRuntimeDriver;
  const next = await refreshSandboxObservedState(
    context.state.sandboxes,
    driver,
    context.records.get("sbx_test") as ManagedSandboxRecord,
  );
  assert.equal(next.lifecycleState, "stopped");
  assert.equal(next.observedState, "reconnecting");
});
