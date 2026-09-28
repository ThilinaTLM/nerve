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
