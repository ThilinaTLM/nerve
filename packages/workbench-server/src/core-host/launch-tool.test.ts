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
  parentFolderId: null,
  order: 0,
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
  displayName: "Dev",
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
  const restarts: string[] = [];
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
    prepareRestart: async (id) => {
      const source = rows.find((row) => row.id === id)!;
      return {
        command: source.command,
        cwd: source.cwd,
        projectId: source.projectId,
        displayName: source.displayName,
        restartedFromLaunchId: source.id,
      };
    },
    restartPrepared: async (id, request) => {
      assert.equal(request.preparedShell.command, request.command);
      restarts.push(id);
      const source = rows.find((row) => row.id === id)!;
      const row = {
        ...source,
        id: "launch_new",
        restartRootLaunchId: source.restartRootLaunchId ?? source.id,
        restartedFromLaunchId: source.id,
      };
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
    restarts,
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
    '"Dev" — command: "old command" idle :3000',
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
    '"Dev" — command: "old command"; runId: launch_one completed ready http://localhost:3000 :3000 exit 0',
  );
  const f = fixture();
  f.setRows([
    { ...record, definitionId: undefined, displayName: "Ad hoc" },
    { ...record, id: "launch_foreign", projectId: "proj_other" },
  ]);
  assert.equal(
    (await f.tool.execute({ action: "status" }, "conv_one")).content,
    '"Dev" — command: "old command" idle\n"Ad hoc" — command: "old command"; runId: launch_one running',
  );
});

void test("single policy reports existing launch without taking ownership", async () => {
  const f = fixture();
  f.setOutcome({ disposition: "focused_existing", launch: record });
  assert.equal(
    (await f.tool.execute({ action: "start", name: "Dev" }, "conv_one"))
      .content,
    'Already running: "Dev" — command: "old command"; runId: launch_one',
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
    (await f.tool.execute({ action: "start", name: "Dev" }, "conv_one"))
      .content,
    '"Dev" — command: "old command"\nPort conflict :3000\nPID 42 node',
  );
  assert.equal("terminateListeners" in (f.starts[0] as object), false);
});

void test("restart uses its admitted definition capture even when stopping changes the catalog", async () => {
  const f = fixture();
  f.setRows([{ ...record }]);
  await f.tool.execute(
    { action: "restart", name: "Dev", runId: record.id },
    "conv_one",
  );
  assert.equal((f.starts[0] as { command: string }).command, "old command");
  const empty = fixture();
  assert.equal(
    (await empty.tool.execute({ action: "restart", name: "Dev" }, "conv_one"))
      .content,
    'Started: "Dev" — command: "old command"; runId: launch_new',
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
          { action: "logs", name: "Dev", offset: 1, limit: 1 },
          "conv_one",
        )
      ).content,
      `"Dev" — command: "old command"; runId: launch_one\nLines 1-1 of 3 (running).\ntwo\nNext offset: 2\nFile: ${combinedPath}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("only agent-started launches exiting on their own send one notice", async () => {
  const f = fixture();
  await f.tool.changed("launch.completed", { ...record, status: "completed" });
  assert.equal(f.notices.length, 0);
  await f.tool.execute({ action: "start", name: "Dev" }, "conv_one", "user");
  await f.tool.changed("launch.completed", {
    ...record,
    id: "launch_new",
    status: "completed",
  });
  assert.equal(f.notices.length, 0);
  await f.tool.execute({ action: "start", name: "Dev" }, "conv_one");
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
  await f.tool.execute({ action: "start", name: "Dev" }, "conv_one");
  await f.tool.execute(
    { action: "stop", name: "Dev", runId: "launch_new" },
    "conv_one",
  );
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
    { action: "status", name: "Dev" },
    { action: "start" },
    { action: "stop", name: "Dev", runId: record.id, limit: 1 },
    { action: "logs", name: "Dev", runId: record.id, offset: -1 },
    { action: "logs", name: "Dev", runId: record.id, limit: 501 },
    { action: "start", name: "Dev", terminateListeners: [] },
    { action: "start", id: definition.id },
    { action: "logs", name: "Dev", runId: " " },
    { action: "start", name: "Dev", runId: record.id },
    { action: "start", name: " " },
  ])
    await assert.rejects(
      f.tool.execute(args, "conv_one"),
      /Invalid launch arguments/,
    );
  f.setRows([{ ...record, projectId: "proj_other" }]);
  await assert.rejects(
    f.tool.execute(
      { action: "stop", name: "Dev", runId: record.id },
      "conv_one",
    ),
    /not found for this name in this project/,
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
      (await f.tool.execute({ action: "start", name: "Dev" }, "conv_one"))
        .content,
      `Started: "Dev" — command: "old command"; runId: launch_new\n${ready ? "Ready :3000" : "Not listening after 30s"}`,
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
    await f.tool.execute({ action: "start", name: "Dev" }, "conv_starter");
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
  f.setRows([{ ...record, definitionId: undefined, displayName: "Ad hoc" }]);
  assert.equal(
    (await f.tool.execute({ action: "start", name: "Ad hoc" }, "conv_one"))
      .content,
    'Already running: "Ad hoc" — command: "old command"; runId: launch_one',
  );
  assert.equal(
    (
      await f.tool.execute(
        { action: "restart", name: "Ad hoc", runId: record.id },
        "conv_one",
      )
    ).content,
    'Started: "Ad hoc" — command: "old command"; runId: launch_new',
  );
  assert.deepEqual(f.restarts, [record.id]);
  const restarted = await f.options.launches.get("launch_new");
  assert.equal(restarted?.displayName, "Ad hoc");
  assert.equal(restarted?.command, record.command);
  assert.equal(restarted?.cwd, record.cwd);
  assert.equal(f.starts.length, 0);
});

void test("name selectors use trimmed labels or commands and match case exactly", async () => {
  const f = fixture();
  f.setDefinition({ ...definition, label: "  Dev  " });
  await f.tool.execute({ action: "start", name: " Dev " }, "conv_one");
  assert.equal(
    (f.starts[0] as { definitionId: string }).definitionId,
    definition.id,
  );
  await assert.rejects(
    f.tool.execute({ action: "start", name: "dev" }, "conv_one"),
    /name not found/,
  );
  await assert.rejects(
    f.tool.execute({ action: "start", name: definition.id }, "conv_one"),
    /name not found/,
  );
  f.setDefinition({ ...definition, label: " " });
  const result = await f.tool.execute(
    { action: "start", name: "old command" },
    "conv_one",
  );
  assert.equal(
    result.content,
    'Started: "old command" — command: "old command"; runId: launch_new',
  );
  assert.equal(
    (f.starts[1] as { displayName: string }).displayName,
    "old command",
  );
});

void test("duplicate definition names fail safely even with a run selector", async () => {
  const f = fixture();
  f.options.definitions.list = async () => [
    definition,
    { ...definition, id: "launchdef_other", command: "other command" },
  ];
  f.setRows([record]);
  for (const args of [
    { action: "start", name: "Dev" },
    { action: "stop", name: "Dev", runId: record.id },
  ]) {
    await assert.rejects(
      f.tool.execute(args, "conv_one"),
      /Ambiguous launch name "Dev".*old command.*other command/,
    );
  }
  assert.equal(f.starts.length, 0);
  assert.equal(record.status, "running");
});

void test("run selectors validate lineage and select a specific run instead of latest", async () => {
  const f = fixture();
  const latest = { ...record, id: "launch_latest" };
  const older = { ...record, id: "launch_older" };
  const unrelated = {
    ...record,
    id: "launch_unrelated",
    definitionId: "launchdef_other",
  };
  f.setRows([latest, older, unrelated]);
  await assert.rejects(
    f.tool.execute(
      { action: "stop", name: "Dev", runId: unrelated.id },
      "conv_one",
    ),
    /not found for this name/,
  );
  await f.tool.execute(
    { action: "stop", name: "Dev", runId: older.id },
    "conv_one",
  );
  assert.equal(older.status, "cancelled");
  assert.equal(latest.status, "running");
  await f.tool.execute({ action: "stop", name: "Dev" }, "conv_one");
  assert.equal(latest.status, "cancelled");
});

void test("ad-hoc names are disambiguated with execution IDs", async () => {
  const f = fixture();
  const first = { ...record, definitionId: undefined, displayName: "Ad hoc" };
  const second = { ...first, id: "launch_second", command: "second command" };
  f.setRows([first, second]);
  await assert.rejects(
    f.tool.execute({ action: "stop", name: "Ad hoc" }, "conv_one"),
    /Ambiguous launch name.*Supply runId/,
  );
  await f.tool.execute(
    { action: "stop", name: "Ad hoc", runId: second.id },
    "conv_one",
  );
  assert.equal(first.status, "running");
  assert.equal(second.status, "cancelled");
});

void test("status distinguishes current configuration from an older executed command", async () => {
  assert.equal(
    formatLaunchStatus({ ...definition, command: "new command" }, record),
    '"Dev" — command: "new command"; run command: "old command"; runId: launch_one running',
  );
  const f = fixture();
  f.setRows([{ ...record }]);
  const status = (await f.tool.execute({ action: "status" }, "conv_one"))
    .content;
  assert.equal(status.includes(definition.id), false);
  f.setDefinition({ ...definition, command: "new command" });
  await f.tool.execute({ action: "restart", name: "Dev" }, "conv_one");
  assert.equal((f.starts[0] as { command: string }).command, "new command");
});

void test("ad-hoc restart generations share one name and select latest without ambiguity", async () => {
  const f = fixture();
  const old = {
    ...record,
    definitionId: undefined,
    displayName: undefined,
    name: "Watcher",
  };
  const latest = {
    ...old,
    id: "launch_latest",
    restartRootLaunchId: old.id,
    restartedFromLaunchId: old.id,
  };
  f.setRows([latest, old]);
  const result = await f.tool.execute(
    { action: "stop", name: "Watcher" },
    "conv_one",
  );
  assert.equal(
    result.content,
    'Stopped: "Watcher" — command: "old command"; runId: launch_latest',
  );
  assert.equal(latest.status, "cancelled");
  assert.equal(old.status, "running");
});

void test("idle definitions identify their command on stop and report unavailable logs", async () => {
  const f = fixture();
  assert.equal(
    (await f.tool.execute({ action: "stop", name: "Dev" }, "conv_one")).content,
    'Nothing running: "Dev" — command: "old command"',
  );
  await assert.rejects(
    f.tool.execute({ action: "logs", name: "Dev" }, "conv_one"),
    /Definition has no launches/,
  );
});

void test("status exposes every run while name-only actions still select the latest", async () => {
  const f = fixture();
  const latest = { ...record, id: "launch_latest" };
  const older = {
    ...record,
    id: "launch_older",
    status: "completed" as const,
    command: "previous command",
    exitCode: 0,
  };
  f.setRows([latest, older]);
  assert.equal(
    (await f.tool.execute({ action: "status" }, "conv_one")).content,
    '"Dev" — command: "old command"; runId: launch_latest running\n"Dev" — command: "old command"; run command: "previous command"; runId: launch_older completed exit 0',
  );
  await f.tool.execute({ action: "stop", name: "Dev" }, "conv_one");
  assert.equal(latest.status, "cancelled");
  assert.equal(older.status, "completed");
});

void test("restart cannot start another execution when selected run fails to stop", async () => {
  const f = fixture();
  const latest = { ...record, id: "launch_latest" };
  const selected = { ...record, id: "launch_selected" };
  f.setRows([latest, selected]);
  const cancels: string[] = [];
  f.options.launches.cancel = async (id) => {
    cancels.push(id);
    return selected;
  };
  await assert.rejects(
    f.tool.execute(
      { action: "restart", name: "Dev", runId: selected.id },
      "conv_one",
    ),
    /still running and cannot be restarted/,
  );
  assert.deepEqual(cancels, [selected.id]);
  assert.equal(f.starts.length, 0);
  assert.equal(f.restarts.length, 0);
  assert.equal(latest.status, "running");
});

void test("deleted definitions leave project-owned runs selectable as standalone", async () => {
  const f = fixture();
  f.options.definitions.list = async () => [];
  f.options.definitions.get = async () => {
    throw new Error("Deleted definition must not be resolved");
  };
  f.setRows([
    { ...record, cwd: "/external", status: "completed" },
    { ...record, id: "launch_foreign", projectId: "proj_other" },
  ]);
  const status = await f.tool.execute({ action: "status" }, "conv_one");
  assert.match(status.content, /launch_one completed/);
  assert.doesNotMatch(status.content, /launch_foreign/);
  await f.tool.execute(
    { action: "restart", name: "Dev", runId: record.id },
    "conv_one",
    "user",
  );
  assert.deepEqual(f.restarts, [record.id]);
  assert.deepEqual(f.starts, []);
});
