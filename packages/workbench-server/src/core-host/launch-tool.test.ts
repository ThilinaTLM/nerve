import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "@nervekit/contracts/core";
import type { LaunchDefinition } from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  LaunchTool,
  formatLaunchStatus,
  type LaunchToolOptions,
} from "./launch-tool.js";

const definition: LaunchDefinition = {
  id: "launchdef_dev",
  scope: { kind: "project", projectId: "proj_one" },
  label: "Dev",
  command: "old command",
  runPolicy: "single",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const record: LaunchRecord = {
  id: "launch_one",
  definitionId: definition.id,
  projectId: "proj_one",
  command: "old command",
  cwd: "/project",
  status: "running",
  readiness: { outcome: "none" },
  stdoutPath: "/missing/stdout",
  stderrPath: "/missing/stderr",
  logsPath: "/missing/logs",
  startedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  visibility: "background",
};
function fixture() {
  let rows: LaunchRecord[] = [];
  let current = { ...definition };
  const notices: string[] = [];
  const starts: unknown[] = [];
  let outcome:
    | Awaited<ReturnType<LaunchToolOptions["launches"]["launchDefinition"]>>
    | undefined;
  const launches: LaunchToolOptions["launches"] = {
    list: async (filter) =>
      rows.filter((row) => row.projectId === filter?.projectId),
    get: async (id) => rows.find((row) => row.id === id),
    cancel: async (id) => {
      const row = rows.find((row) => row.id === id)!;
      row.status = "cancelled";
      await tool.changed("launch.stop_requested", row);
      current = { ...current, command: "new command" };
      return row;
    },
    restart: async () => {
      const row = { ...record, id: "launch_new", definitionId: undefined };
      rows.unshift(row);
      return row;
    },
    launchDefinition: async (input) => {
      starts.push(input);
      if (outcome) return outcome;
      const row = { ...record, id: "launch_new", command: input.command };
      rows.unshift(row);
      return { disposition: "started", launch: row };
    },
  };
  const options: LaunchToolOptions = {
    launches,
    definitions: {
      list: async () => [current],
      get: async (_project, id) => {
        assert.equal(id, definition.id);
        return current;
      },
    },
    project: () => ({ id: "proj_one", directory: "/project" }) as Project,
    notify: (_conversation, _launch, text) => notices.push(text),
  };
  const tool = new LaunchTool(options);
  return {
    tool,
    options,
    notices,
    starts,
    setRows: (value: LaunchRecord[]) => {
      rows = value;
    },
    setDefinition: (value: LaunchDefinition) => {
      current = value;
    },
    setOutcome: (value: typeof outcome) => {
      outcome = value;
    },
  };
}

void test("status formats definitions first, idle, readiness, port and exits", async () => {
  assert.equal(
    formatLaunchStatus({ ...definition, port: 3000 }),
    "launchdef_dev Dev idle :3000",
  );
  assert.equal(
    formatLaunchStatus(
      { ...definition, port: 3000 },
      {
        ...record,
        status: "completed",
        exitCode: 0,
        readiness: { outcome: "ready", readyUrl: "http://localhost:3000" },
      },
    ),
    "launchdef_dev Dev completed ready http://localhost:3000 :3000 exit 0 launch_one",
  );
  const f = fixture();
  f.setRows([
    { ...record, definitionId: undefined, displayName: "Ad hoc" },
    { ...record, id: "launch_foreign", projectId: "proj_other" },
  ]);
  assert.equal(
    (await f.tool.execute({ action: "status" }, "conv_one")).content,
    "launchdef_dev Dev idle\nlaunch_one Ad hoc running launch_one",
  );
});

void test("single policy reports existing launch without taking ownership", async () => {
  const f = fixture();
  f.setOutcome({ disposition: "focused_existing", launch: record });
  assert.equal(
    (await f.tool.execute({ action: "start", id: definition.id }, "conv_one"))
      .content,
    "Already running: launch_one",
  );
  await f.tool.changed("launch.completed", {
    ...record,
    status: "completed",
    exitCode: 0,
  });
  assert.deepEqual(f.notices, []);
});

void test("port conflicts report PID and name, never request listener termination", async () => {
  const f = fixture();
  f.setOutcome({
    disposition: "port_conflict",
    conflict: {
      port: 3000,
      listeners: [
        {
          port: 3000,
          pid: 42,
          processName: "node",
          protocol: "tcp",
          address: "127.0.0.1",
          identity: "linux:123",
        },
      ],
    },
  });
  assert.equal(
    (await f.tool.execute({ action: "start", id: definition.id }, "conv_one"))
      .content,
    "Port conflict :3000\nPID 42 node",
  );
  assert.equal("terminateListeners" in (f.starts[0] as object), false);
});

void test("restart re-reads current definition after stop, including by launch id", async () => {
  const f = fixture();
  f.setRows([{ ...record }]);
  await f.tool.execute({ action: "restart", id: record.id }, "conv_one");
  assert.equal((f.starts[0] as { command: string }).command, "new command");
  const empty = fixture();
  assert.equal(
    (
      await empty.tool.execute(
        { action: "restart", id: definition.id },
        "conv_one",
      )
    ).content,
    "Started: launch_new",
  );
});

void test("logs resolve definition to latest launch and page combined output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-tool-"));
  try {
    const combinedPath = join(dir, "output.txt");
    await writeFile(combinedPath, "one\ntwo\nthree\n");
    const f = fixture();
    f.setRows([
      { ...record, combinedPath },
      { ...record, id: "launch_old" },
    ]);
    assert.equal(
      (
        await f.tool.execute(
          { action: "logs", id: definition.id, offset: 1, limit: 1 },
          "conv_one",
        )
      ).content,
      `Lines 1-1 of 3 (running).\ntwo\nNext offset: 2\nFile: ${combinedPath}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("only agent-started launches exiting on their own send one notice", async () => {
  const f = fixture();
  await f.tool.changed("launch.completed", { ...record, status: "completed" });
  assert.equal(f.notices.length, 0);
  await f.tool.execute(
    { action: "start", id: definition.id },
    "conv_one",
    "user",
  );
  await f.tool.changed("launch.completed", {
    ...record,
    id: "launch_new",
    status: "completed",
  });
  assert.equal(f.notices.length, 0);
  await f.tool.execute({ action: "start", id: definition.id }, "conv_one");
  await f.tool.changed("launch.completed", {
    ...record,
    id: "launch_new",
    status: "completed",
    exitCode: 0,
  });
  await f.tool.changed("launch.completed", {
    ...record,
    id: "launch_new",
    status: "completed",
    exitCode: 0,
  });
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /Status: completed; exit code: 0/);
  await f.tool.execute({ action: "start", id: definition.id }, "conv_one");
  await f.tool.execute({ action: "stop", id: "launch_new" }, "conv_one");
  await f.tool.changed("launch.cancelled", {
    ...record,
    id: "launch_new",
    status: "cancelled",
  });
  assert.equal(f.notices.length, 1);
});

void test("action-specific args and foreign project IDs are rejected", async () => {
  const f = fixture();
  for (const args of [
    { action: "status", id: definition.id },
    { action: "start" },
    { action: "stop", id: record.id, limit: 1 },
    { action: "logs", id: record.id, offset: -1 },
    { action: "logs", id: record.id, limit: 501 },
    { action: "start", id: definition.id, terminateListeners: [] },
  ])
    await assert.rejects(
      f.tool.execute(args, "conv_one"),
      /Invalid launch arguments/,
    );
  f.setRows([{ ...record, projectId: "proj_other" }]);
  await assert.rejects(
    f.tool.execute({ action: "stop", id: record.id }, "conv_one"),
    /not found in this project/,
  );
});

void test("configured port readiness returns ready or bounded timeout", async () => {
  for (const ready of [true, false]) {
    const f = fixture();
    f.setDefinition({ ...definition, port: 3000 });
    let now = 0;
    f.options.now = () => now;
    f.options.sleep = async (ms) => {
      now += ms;
    };
    f.options.inspectPort = async () =>
      ready
        ? [
            {
              port: 3000,
              pid: 42,
              protocol: "tcp",
              address: "127.0.0.1",
              identity: "linux:123",
            },
          ]
        : [];
    assert.equal(
      (await f.tool.execute({ action: "start", id: definition.id }, "conv_one"))
        .content,
      `Started: launch_new\n${ready ? "Ready :3000" : "Not listening after 30s"}`,
    );
    assert.ok(now <= 30_000);
  }
});

void test("an immediate exit during start delivers projected output to the starting conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-notice-"));
  try {
    const combinedPath = join(dir, "output.txt");
    await writeFile(combinedPath, "Error: startup failed\n");
    const f = fixture();
    let recipient = "";
    f.options.notify = (conversationId, _launch, text) => {
      recipient = conversationId;
      f.notices.push(text);
    };
    f.options.launches.launchDefinition = async () => {
      const exited: LaunchRecord = {
        ...record,
        id: "launch_quick",
        combinedPath,
        status: "failed",
        exitCode: 1,
      };
      await f.tool.changed("launch.failed", exited);
      return { disposition: "started", launch: exited };
    };
    await f.tool.execute(
      { action: "start", id: definition.id },
      "conv_starter",
    );
    assert.equal(recipient, "conv_starter");
    assert.equal(f.notices.length, 1);
    assert.match(
      f.notices[0],
      /Status: failed; exit code: 1\nError: startup failed/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("definition-less launch restarts with its settings and does not stop on start", async () => {
  const f = fixture();
  f.setRows([{ ...record, definitionId: undefined }]);
  assert.equal(
    (await f.tool.execute({ action: "start", id: record.id }, "conv_one"))
      .content,
    "Already running: launch_one",
  );
  assert.equal(
    (await f.tool.execute({ action: "restart", id: record.id }, "conv_one"))
      .content,
    "Started: launch_new",
  );
  assert.equal(f.starts.length, 0);
});
