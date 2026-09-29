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

test("retains disconnected demand and replays every resource when ready", async () => {
  const calls: Call[] = [];
  let ready = false;
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    request: requestRecorder(calls),
    isReady: () => ready,
  });

  await coordinator.syncProject("proj_one", ["src"]);
  await coordinator.syncProject("proj_two", ["docs"]);
  await coordinator.syncRepository("proj_one", ".", true);
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
      [
        "git.repository.monitor.sync",
        { projectId: "proj_one", repo: ".", active: true },
      ],
    ],
  );
});

test("clears only the addressed resource and does not replay removed demand", async () => {
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

test("serializes updates so the latest resource demand is delivered last", async () => {
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

test("orders a repository refresh after this client's own slow monitor sync", async () => {
  const calls: Call[] = [];
  let releaseSync!: () => void;
  const syncPending = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => true,
    request: scriptedRequest(calls, async () => {
      await syncPending;
      return {};
    }),
  });

  const sync = coordinator.syncRepository("proj_one", ".", true);
  const refresh = coordinator.refreshRepository("proj_one", ".");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    calls.map((call) => call.method),
    ["git.repository.monitor.sync"],
  );
  releaseSync();
  await sync;
  assert.equal(await refresh, true);
  assert.deepEqual(
    calls.map((call) => [call.method, call.params]),
    [
      [
        "git.repository.monitor.sync",
        { projectId: "proj_one", repo: ".", active: true },
      ],
      ["git.repository.refresh", { projectId: "proj_one", repo: "." }],
    ],
  );
});

test("skips repository refresh without demand, while offline, or after reset", async () => {
  const calls: Call[] = [];
  let ready = true;
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => ready,
    request: scriptedRequest(calls),
  });

  assert.equal(await coordinator.refreshRepository("proj_one", "."), false);

  ready = false;
  await coordinator.syncRepository("proj_one", ".", true);
  assert.equal(await coordinator.refreshRepository("proj_one", "."), false);

  ready = true;
  await coordinator.syncRepository("proj_one", ".", true);
  calls.length = 0;
  const refresh = coordinator.refreshRepository("proj_one", ".");
  coordinator.reset();
  assert.equal(await refresh, false);
  assert.equal(await coordinator.refreshRepository("proj_one", "."), false);
  assert.deepEqual(calls, []);
});

test("a rejected monitor sync does not block the queued refresh", async () => {
  const calls: Call[] = [];
  const coordinator = new WorkspaceMonitorDemandCoordinator({
    isReady: () => true,
    request: scriptedRequest(calls, async () => {
      throw new Error("sync failed");
    }),
  });

  const sync = coordinator.syncRepository("proj_one", ".", true);
  const refresh = coordinator.refreshRepository("proj_one", ".");
  await assert.rejects(sync, /sync failed/);
  assert.equal(await refresh, true);
  assert.equal(calls.at(-1)?.method, "git.repository.refresh");
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
