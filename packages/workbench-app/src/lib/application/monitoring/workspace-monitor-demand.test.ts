import assert from "node:assert/strict";
import test from "node:test";
import type { OperationName } from "@nervekit/contracts/operations";
import { WorkspaceMonitorDemandCoordinator } from "./workspace-monitor-demand";

type Call = { method: OperationName; params: unknown };

function requestRecorder(calls: Call[]) {
  return (async (method: OperationName, params: unknown) => {
    calls.push({ method, params });
    return {};
  }) as ConstructorParameters<
    typeof WorkspaceMonitorDemandCoordinator
  >[0]["request"];
}

test("retains disconnected demand and replays every project when ready", async () => {
  const calls: Call[] = [];
  let ready = false;
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    request: requestRecorder(calls),
    isReady: () => ready,
  });

  await coordinator.syncProject("proj_one", ["src"]);
  await coordinator.syncProject("proj_two", ["docs"]);
  assert.equal(calls.length, 0);

  ready = true;
  await coordinator.reconcile();
  assert.deepEqual(
    calls.map((call) => [call.method, call.params]),
    [
      [
        "filesystem.project.monitor.sync",
        { projectId: "proj_one", directories: ["src"] },
      ],
      [
        "filesystem.project.monitor.sync",
        { projectId: "proj_two", directories: ["docs"] },
      ],
    ],
  );
});

test("clears only the addressed project and does not replay removed demand", async () => {
  const calls: Call[] = [];
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    request: requestRecorder(calls),
    isReady: () => true,
  });

  await coordinator.syncProject("proj_one", ["src"]);
  await coordinator.syncProject("proj_two", ["docs"]);
  calls.length = 0;
  await coordinator.clearProject("proj_one");
  await coordinator.reconcile();

  assert.deepEqual(
    calls.map((call) => [call.method, call.params]),
    [
      ["filesystem.project.monitor.clear", { projectId: "proj_one" }],
      [
        "filesystem.project.monitor.sync",
        { projectId: "proj_two", directories: ["docs"] },
      ],
    ],
  );
});

test("serializes updates so the latest project demand is delivered last", async () => {
  const calls: Call[] = [];
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let requestCount = 0;
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => true,
    request: (async (method: OperationName, params: unknown) => {
      calls.push({ method, params });
      requestCount += 1;
      if (requestCount === 1) await firstPending;
      return {};
    }) as ConstructorParameters<
      typeof WorkspaceMonitorDemandCoordinator
    >[0]["request"],
  });

  const first = coordinator.syncProject("proj_one", ["src"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = coordinator.syncProject("proj_one", ["docs"]);
  assert.equal(calls.length, 1);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(calls.at(-1), {
    method: "filesystem.project.monitor.sync",
    params: { projectId: "proj_one", directories: ["docs"] },
  });
});

type Request = ConstructorParameters<
  typeof WorkspaceMonitorDemandCoordinator
>[0]["request"];

function scriptedRequest(
  calls: Call[],
  respond: (method: OperationName) => Promise<unknown> = async () => ({}),
): Request {
  return (async (method: OperationName, params: unknown) => {
    calls.push({ method, params });
    if (method.endsWith(".refresh")) return { active: true, generation: 1 };
    return respond(method);
  }) as Request;
}

test("skips project refresh without demand, while offline, or after reset", async () => {
  const calls: Call[] = [];
  let ready = true;
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => ready,
    request: scriptedRequest(calls),
  });

  assert.equal(await coordinator.refreshProject("proj_one"), false);

  ready = false;
  await coordinator.syncProject("proj_one", ["src"]);
  assert.equal(await coordinator.refreshProject("proj_one"), false);

  ready = true;
  await coordinator.syncProject("proj_one", ["src"]);
  calls.length = 0;
  const refresh = coordinator.refreshProject("proj_one");
  coordinator.reset();
  assert.equal(await refresh, false);
  assert.equal(await coordinator.refreshProject("proj_one"), false);
  assert.deepEqual(calls, []);
});

test("orders a project refresh after the project's monitor sync", async () => {
  const calls: Call[] = [];
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => true,
    request: scriptedRequest(calls),
  });

  const sync = coordinator.syncProject("proj_one", ["src"]);
  const refresh = coordinator.refreshProject("proj_one");
  await sync;
  assert.equal(await refresh, true);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["filesystem.project.monitor.sync", "filesystem.project.refresh"],
  );
});

test("project sync resolves with the server monitor state, or undefined when skipped", async () => {
  let ready = false;
  const state = { active: true, degraded: true, watchedDirectoryCount: 2 };
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => ready,
    request: (async () => state) as ConstructorParameters<
      typeof WorkspaceMonitorDemandCoordinator
    >[0]["request"],
  });

  assert.equal(
    await coordinator.syncProject("proj_one", ["", "src"]),
    undefined,
  );
  ready = true;
  assert.deepEqual(
    await coordinator.syncProject("proj_one", ["", "src"]),
    state,
  );
});
