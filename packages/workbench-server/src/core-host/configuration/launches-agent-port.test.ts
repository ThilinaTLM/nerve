import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { LaunchDefinitionRepository } from "../../domains/launch-definitions/launch-definition.repository.js";
import { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { LaunchRuns, type LaunchRunsOptions } from "../launch-runs.js";
import { createLaunchesAgentPort } from "./launches-agent-port.js";

const run = (fields: Partial<LaunchRecord>): LaunchRecord => ({
  id: "launch_one",
  projectId: "proj_one",
  command: "pnpm dev",
  cwd: "/project",
  status: "running",
  readiness: { outcome: "none" },
  stdoutPath: "/missing/stdout",
  stderrPath: "/missing/stderr",
  logsPath: "/missing/logs",
  startedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  visibility: "background",
  ...fields,
});

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "launches-port-"));
  t.after(() => removeTree(root));
  const directory = join(root, "project");
  await mkdir(directory);
  const project = { id: "proj_one", directory } as Project;
  const getProject = () => project;
  const service = new LaunchDefinitionService(
    new LaunchDefinitionRepository(
      getProject,
      new ProjectMigrationService({ home: join(root, "home") }),
    ),
    getProject,
  );
  let rows: LaunchRecord[] = [];
  const notices: { conversation: string; text: string }[] = [];
  const starts: { command: string; cwd: string; definitionId: string }[] = [];
  const restarts: string[] = [];
  let outcome:
    | Awaited<ReturnType<LaunchRunsOptions["launches"]["launchDefinition"]>>
    | undefined;
  const launches: LaunchRunsOptions["launches"] = {
    list: async (filter) =>
      rows.filter((row) => row.projectId === filter?.projectId),
    get: async (id) => rows.find((row) => row.id === id),
    cancel: async (id) => {
      const row = rows.find((item) => item.id === id)!;
      row.status = "cancelled";
      await runs.changed("launch.stop_requested", row);
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
      restarts.push(id);
      const row = run({
        id: `launch_${rows.length + 1}`,
        command: request.command,
        displayName: request.displayName,
        restartRootLaunchId: id,
        startedAt: "2026-01-02T00:00:00Z",
      });
      rows.unshift(row);
      return row;
    },
    launchDefinition: async (input) => {
      starts.push({
        command: input.command,
        cwd: input.cwd,
        definitionId: input.definitionId,
      });
      if (outcome) return outcome;
      const row = run({
        id: `launch_${rows.length + 1}`,
        definitionId: input.definitionId,
        command: input.command,
        startedAt: "2026-01-02T00:00:00Z",
      });
      rows.unshift(row);
      return { disposition: "started", launch: row };
    },
  };
  const options: LaunchRunsOptions = {
    launches,
    notify: (conversation, _launch, text) =>
      notices.push({ conversation, text }),
  };
  const runs = new LaunchRuns(options);
  const portFor = (origin: "model" | "user" = "model") =>
    createLaunchesAgentPort({
      definitions: service,
      project: () => project,
      runs,
      caller: { conversationId: "conv_one", origin },
      shell: { available: true, path: "/bin/sh" },
    });
  return {
    service,
    project,
    port: portFor(),
    portFor,
    runs,
    options,
    notices,
    starts,
    restarts,
    directory,
    setRows: (value: LaunchRecord[]) => {
      rows = value;
    },
    setOutcome: (value: typeof outcome) => {
      outcome = value;
    },
    file: join(directory, ".nerve", "launches", "definitions.json"),
  };
}

void test("create, update, move and remove by label keep order consistent", async (t) => {
  const { port } = await fixture(t);
  const web = await port.create({
    label: "web",
    command: "pnpm dev",
    port: 3000,
  });
  const api = await port.create({
    command: "pnpm api",
    runPolicy: "concurrent",
  });
  assert.match(web.id, /^launchdef_/);
  assert.equal(web.name, "web");
  assert.equal(api.name, "pnpm api");
  assert.deepEqual([web.order, api.order], [0, 1]);

  const folder = await port.createFolder({ label: "apps" });
  await port.move("pnpm api", { folder: "apps" });
  await port.move("web", { folder: "apps", before: "pnpm api" });
  let catalog = await port.list();
  const inside = catalog.definitions
    .filter((definition) => definition.folder === folder.id)
    .sort((a, b) => a.order - b.order);
  assert.deepEqual(
    inside.map((definition) => [definition.name, definition.order]),
    [
      ["web", 0],
      ["pnpm api", 1],
    ],
  );

  const updated = await port.update("web", {
    command: "pnpm start",
    port: null,
  });
  assert.equal(updated.command, "pnpm start");
  assert.equal(updated.label, "web");
  assert.equal(updated.port, undefined);

  await port.remove(web.id);
  catalog = await port.list();
  assert.deepEqual(
    catalog.definitions.map((definition) => [
      definition.name,
      definition.order,
    ]),
    [["pnpm api", 0]],
  );
});

void test("names that are missing or shared fail with the names and ids to use", async (t) => {
  const { port } = await fixture(t);
  await port.create({ label: "web", command: "pnpm dev" });
  await port.createFolder({ label: "apps" });
  const second = await port.create({
    label: "web",
    command: "pnpm web",
    folder: "apps",
  });
  await assert.rejects(
    port.remove("webb"),
    /No launch is named "webb"\. Names: "web"/,
  );
  await assert.rejects(
    port.update("web", { command: "x" }),
    /2 entries are named "web": launchdef_\w+ \(at the top level\), launchdef_\w+ \(in folder "apps"\)\. Pass the id/,
  );
  assert.equal(
    (await port.update(second.id, { command: "pnpm web2" })).command,
    "pnpm web2",
  );
  await assert.rejects(port.remove("apps"), /is a folder/);
  await assert.rejects(
    port.move("launchdef_missing", {}),
    /No entry has the id "launchdef_missing"/,
  );
  await assert.rejects(
    port.create({ command: "   " }),
    /Invalid launch definition: command: Command must be nonblank/,
  );
});

void test("an invalid catalog on disk refuses reads and writes with the fix", async (t) => {
  const { port, file } = await fixture(t);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "{ not json");
  await assert.rejects(
    port.list(),
    /definitions\.json is invalid.*configuration\.check/s,
  );
  await assert.rejects(port.create({ command: "x" }), /changes are refused/);
  await assert.rejects(
    port.prepareStart({ name: "web" }, "start"),
    /cannot be read: .*definitions\.json is invalid/,
  );
});

void test("start resolves the exact command before authorization and reports the run", async (t) => {
  const f = await fixture(t);
  const web = await f.port.create({
    label: "web",
    command: "pnpm dev",
    cwd: "app",
  });
  const prepared = await f.port.prepareStart({ name: "web" }, "start");
  assert.deepEqual(prepared.process, { command: "pnpm dev", cwd: "app" });
  // A change after the check does not alter what runs.
  await f.port.update("web", { command: "rm -rf /" });
  const result = await prepared.start();
  assert.equal(result.outcome, "started");
  assert.equal(result.name, "web");
  assert.deepEqual(f.starts, [
    {
      command: "pnpm dev",
      cwd: join(f.directory, "app"),
      definitionId: web.id,
    },
  ]);
  const listed = (await f.port.list()).definitions[0];
  assert.deepEqual(
    listed.runs.map((item) => [item.runId, item.name, item.status]),
    [[result.runId, "web", "running"]],
  );
});

void test("a single definition already running and a port conflict start nothing", async (t) => {
  const f = await fixture(t);
  await f.port.create({ label: "web", command: "pnpm dev", port: 3000 });
  f.setOutcome({
    disposition: "focused_existing",
    launch: run({ id: "launch_live" }),
  });
  const existing = await (
    await f.port.prepareStart({ name: "web" }, "start")
  ).start();
  assert.equal(existing.outcome, "already_running");
  assert.equal(existing.runId, "launch_live");
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
  const conflicted = await f.port.prepareStart({ name: "web" }, "start");
  await assert.rejects(
    conflicted.start(),
    /port 3000 is in use by PID 42 \(node\)\. Do not stop foreign processes/,
  );
});

void test("a configured port is awaited for a bounded time", async (t) => {
  for (const ready of [true, false]) {
    const f = await fixture(t);
    await f.port.create({ label: "web", command: "pnpm dev", port: 3000 });
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
    const result = await (
      await f.port.prepareStart({ name: "web" }, "start")
    ).start();
    assert.equal(result.listening, ready);
    assert.ok(now <= 30_000);
  }
});

void test("only runs a model started and that exit on their own notify the conversation", async (t) => {
  const f = await fixture(t);
  await f.port.create({
    label: "web",
    command: "pnpm dev",
    runPolicy: "concurrent",
  });
  const byUser = await (
    await f.portFor("user").prepareStart({ name: "web" }, "start")
  ).start();
  await f.runs.changed(
    "launch.completed",
    run({ id: byUser.runId, status: "completed" }),
  );
  assert.equal(f.notices.length, 0);
  const byModel = await (
    await f.port.prepareStart({ name: "web" }, "start")
  ).start();
  for (let i = 0; i < 2; i++)
    await f.runs.changed(
      "launch.completed",
      run({ id: byModel.runId, status: "completed", exitCode: 0 }),
    );
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].conversation, "conv_one");
  assert.match(f.notices[0].text, /exited: completed/);
  const stopped = await (
    await f.port.prepareStart({ name: "web" }, "start")
  ).start();
  assert.deepEqual(
    (await f.port.prepareStop({ runId: stopped.runId }).then((p) => p.stop()))
      .stopped,
    true,
  );
  await f.runs.changed(
    "launch.cancelled",
    run({ id: stopped.runId, status: "cancelled" }),
  );
  assert.equal(f.notices.length, 1);
});

void test("restart stops the selected run and starts the definition's current command", async (t) => {
  const f = await fixture(t);
  const web = await f.port.create({ label: "web", command: "pnpm dev" });
  const live = run({ id: "launch_live", definitionId: web.id, command: "old" });
  f.setRows([live]);
  const result = await (
    await f.port.prepareStart({ name: "web" }, "restart")
  ).start();
  assert.equal(live.status, "cancelled");
  assert.equal(result.outcome, "started");
  assert.equal(f.starts[0].command, "pnpm dev");
});

void test("runs of no definition are named by their display name; several need a runId", async (t) => {
  const f = await fixture(t);
  const first = run({ id: "launch_a", displayName: "Ad hoc" });
  const second = run({
    id: "launch_b",
    displayName: "Ad hoc",
    command: "other",
  });
  f.setRows([first, second]);
  await assert.rejects(
    f.port.prepareStop({ name: "Ad hoc" }).then((p) => p.stop()),
    /Several runs are named "Ad hoc": launch_a .*launch_b .*Pass the runId/,
  );
  await f.port
    .prepareStop({ name: "Ad hoc", runId: "launch_b" })
    .then((p) => p.stop());
  assert.equal(first.status, "running");
  assert.equal(second.status, "cancelled");
  const running = await (
    await f.port.prepareStart({ name: "Ad hoc", runId: "launch_a" }, "start")
  ).start();
  assert.equal(running.outcome, "already_running");
  const restart = await f.port.prepareStart({ runId: "launch_b" }, "start");
  // Outside the project: absolute, as a bash rule would see it.
  assert.deepEqual(restart.process, { command: "other", cwd: "/project" });
  await restart.start();
  assert.deepEqual(f.restarts, ["launch_b"]);
  const listed = await f.port.list();
  assert.deepEqual(listed.runs.map((item) => item.runId).sort(), [
    "launch_3",
    "launch_a",
    "launch_b",
  ]);
});

void test("a runId must belong to the named launch; logs need a run", async (t) => {
  const f = await fixture(t);
  await f.port.create({ label: "web", command: "pnpm dev" });
  f.setRows([run({ id: "launch_other", definitionId: "launchdef_other" })]);
  await assert.rejects(
    f.port
      .prepareStop({ name: "web", runId: "launch_other" })
      .then((p) => p.stop()),
    /not a run of "web"/,
  );
  await assert.rejects(
    f.port.prepareStop({ runId: "launch_missing" }).then((p) => p.stop()),
    /no run "launch_missing"/,
  );
  assert.deepEqual(
    await f.port.prepareStop({ name: "web" }).then((p) => p.stop()),
    { stopped: false },
  );
  await assert.rejects(f.port.logs({ name: "web" }, {}), /has not run yet/);
});

void test("logs page the selected run's combined output", async (t) => {
  const f = await fixture(t);
  const web = await f.port.create({ label: "web", command: "pnpm dev" });
  const combinedPath = join(f.directory, "output.txt");
  await writeFile(combinedPath, "one\ntwo\nthree\n");
  f.setRows([
    run({ id: "launch_new", definitionId: web.id, combinedPath }),
    run({ id: "launch_old", definitionId: web.id }),
  ]);
  const page = await f.port.logs({ name: "web" }, { offset: 1, limit: 1 });
  assert.equal(page.run.runId, "launch_new");
  assert.match(page.output, /^two\nLines 2-2 of 3 \(running\)\./);
});

void test("readOutput returns the run's raw log without paging text", async (t) => {
  const f = await fixture(t);
  const web = await f.port.create({ label: "web", command: "pnpm dev" });
  const combinedPath = join(f.directory, "output.txt");
  await writeFile(combinedPath, "one\ntwo\n");
  f.setRows([run({ id: "launch_new", definitionId: web.id, combinedPath })]);
  const read = await f.port.readOutput("launch_new");
  assert.equal(read.text, "one\ntwo\n");
  assert.equal(read.run.name, "web");
});

void test("without a usable shell nothing starts", async (t) => {
  const f = await fixture(t);
  await f.port.create({ label: "web", command: "pnpm dev" });
  const port = createLaunchesAgentPort({
    definitions: f.service,
    project: () => f.project,
    runs: f.runs,
    caller: { conversationId: "conv_one", origin: "model" },
    shell: { available: false },
  });
  await assert.rejects(
    port.prepareStart({ name: "web" }, "start"),
    /No usable shell is configured/,
  );
  assert.equal(f.starts.length, 0);
});

void test("a shared name is not settled by a run of no definition with that name", async (t) => {
  const f = await fixture(t);
  await f.port.create({ label: "web", command: "pnpm dev" });
  await f.port.createFolder({ label: "apps" });
  await f.port.create({ label: "web", command: "pnpm web", folder: "apps" });
  f.setRows([run({ id: "launch_old", displayName: "web", command: "old" })]);
  await assert.rejects(
    f.port.prepareStart({ name: "web" }, "start"),
    /2 entries are named "web"/,
  );
});

void test("stop is checked against the resolved launch, whatever names it", async (t) => {
  const f = await fixture(t);
  const web = await f.port.create({ label: "web", command: "pnpm dev" });
  f.setRows([
    run({ id: "launch_live", definitionId: web.id }),
    run({ id: "launch_adhoc", displayName: "Ad hoc" }),
  ]);
  for (const selector of [
    { name: "web" },
    { name: " web " },
    { name: web.id },
    { runId: "launch_live" },
  ])
    assert.equal(
      (await f.port.prepareStop(selector)).target,
      `launches:launch/${web.id}`,
    );
  assert.equal(
    (await f.port.prepareStop({ name: "Ad hoc" })).target,
    "launches:run/launch_adhoc",
  );
});

void test("a label that looks like an id is still selectable by name", async (t) => {
  const f = await fixture(t);
  await f.port.create({ label: "launchdef_tools", command: "pnpm tools" });
  assert.equal(
    (await f.port.update("launchdef_tools", { port: 4000 })).port,
    4000,
  );
});
