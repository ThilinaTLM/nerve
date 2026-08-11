import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import {
  projectTaskPanel,
  taskDefinitionLabel,
  taskPanelActiveItemKey,
  taskRunLabel,
} from "./task-panel-controller.js";
import type { TaskPanelDefinition } from "./task-panel-types.js";

function run(id: string, patch: Partial<TaskRecord> = {}): TaskRecord {
  const now = new Date().toISOString();
  return {
    id,
    cwd: "/repo",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/out",
    stderrPath: "/tmp/err",
    logsPath: "/tmp/logs",
    startedAt: now,
    updatedAt: now,
    origin: { kind: "api" },
    visibility: "background",
    ...patch,
  };
}

test("maps selected log streams to their single visual task item", () => {
  assert.equal(taskPanelActiveItemKey(undefined), undefined);
  assert.equal(taskPanelActiveItemKey(run("adhoc")), "adhoc");
  assert.equal(
    taskPanelActiveItemKey(
      run("definition-run", { definitionId: "taskdef_a" }),
    ),
    "taskdef_a",
  );
  assert.equal(
    taskPanelActiveItemKey(
      run("restarted-run", { restartRootTaskId: "original-run" }),
    ),
    "restarted-run",
  );
});

function definition(
  patch: Partial<TaskPanelDefinition> = {},
): TaskPanelDefinition {
  const now = new Date().toISOString();
  return {
    id: "taskdef_a",
    label: "Web",
    command: "pnpm dev",
    runPolicy: "single",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

test("collapses a definition's concurrent runs into one definition entry while listing each run", () => {
  const projected = projectTaskPanel(
    [definition({ runPolicy: "concurrent" })],
    [
      run("task_a", { definitionId: "taskdef_a" }),
      run("task_b", { definitionId: "taskdef_a" }),
    ],
  );
  assert.equal(projected.definitions.length, 1);
  assert.equal(projected.definitions[0]?.runs.length, 2);
  assert.equal(projected.definitions[0]?.activeRuns.length, 2);
  assert.equal(projected.runs.length, 0);
});

test("blends alphabetical and recency ranks without moving a newly run task to the top", () => {
  const definitions = [
    definition({ id: "taskdef_alpha", label: "Alpha" }),
    definition({ id: "taskdef_bravo", label: "Bravo" }),
    definition({ id: "taskdef_charlie", label: "Charlie" }),
    definition({ id: "taskdef_zulu", label: "Zulu" }),
  ];
  const projected = projectTaskPanel(definitions, [
    run("task_zulu", {
      definitionId: "taskdef_zulu",
      startedAt: "2026-01-04T00:00:00Z",
    }),
    run("task_alpha", {
      definitionId: "taskdef_alpha",
      startedAt: "2026-01-03T00:00:00Z",
    }),
    run("task_bravo", {
      definitionId: "taskdef_bravo",
      startedAt: "2026-01-02T00:00:00Z",
    }),
    run("task_charlie", {
      definitionId: "taskdef_charlie",
      startedAt: "2026-01-01T00:00:00Z",
    }),
  ]);

  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.label),
    ["Alpha", "Bravo", "Zulu", "Charlie"],
  );
});

test("lets recency modestly improve nearby alphabetical positions", () => {
  const projected = projectTaskPanel(
    [
      definition({ id: "taskdef_alpha", label: "Alpha" }),
      definition({ id: "taskdef_bravo", label: "Bravo" }),
      definition({ id: "taskdef_charlie", label: "Charlie" }),
      definition({ id: "taskdef_delta", label: "Delta" }),
    ],
    [
      run("task_bravo", {
        definitionId: "taskdef_bravo",
        startedAt: "2026-01-04T00:00:00Z",
      }),
      run("task_charlie", {
        definitionId: "taskdef_charlie",
        startedAt: "2026-01-03T00:00:00Z",
      }),
      run("task_delta", {
        definitionId: "taskdef_delta",
        startedAt: "2026-01-02T00:00:00Z",
      }),
      run("task_alpha", {
        definitionId: "taskdef_alpha",
        startedAt: "2026-01-01T00:00:00Z",
      }),
    ],
  );

  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.label),
    ["Bravo", "Alpha", "Charlie", "Delta"],
  );
});

test("sorts equally ranked definitions deterministically by label", () => {
  const timestamp = "2026-01-01T00:00:00Z";
  const projected = projectTaskPanel(
    [
      definition({
        id: "taskdef_zebra",
        label: "zebra",
        updatedAt: timestamp,
      }),
      definition({
        id: "taskdef_alpha",
        label: "Alpha",
        updatedAt: timestamp,
      }),
    ],
    [],
  );

  assert.deepEqual(
    projected.definitions.map((entry) => entry.definition.id),
    ["taskdef_alpha", "taskdef_zebra"],
  );
});

test("lists only ad-hoc runs at the top level", () => {
  const projected = projectTaskPanel(
    [definition()],
    [run("task_def", { definitionId: "taskdef_a" }), run("task_adhoc")],
  );
  assert.deepEqual(
    projected.runs.map((entry) => entry.key),
    ["task_adhoc"],
  );
  assert.deepEqual(
    projected.definitions[0]?.runs.map((entry) => entry.key),
    ["task_def"],
  );
});

test("keeps definitions without runs and ad-hoc runs without definitions", () => {
  const projected = projectTaskPanel(
    [definition()],
    [run("task_adhoc", { status: "completed" })],
  );
  assert.equal(projected.definitions.length, 1);
  assert.equal(projected.definitions[0]?.runs.length, 0);
  assert.equal(projected.definitions[0]?.latestRun, undefined);
  assert.equal(projected.runs.length, 1);
  assert.equal(projected.runs[0]?.definition, undefined);
  assert.equal(projected.runs[0]?.isActive, false);
});

test("sorts runs with recovery concerns first, then newest first", () => {
  const projected = projectTaskPanel(
    [],
    [
      run("task_old", {
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
      }),
      run("task_new", {
        status: "completed",
        startedAt: "2026-01-03T00:00:00Z",
      }),
      run("task_lost", {
        status: "orphaned",
        startedAt: "2026-01-02T00:00:00Z",
      }),
    ],
  );
  assert.deepEqual(
    projected.runs.map((entry) => entry.key),
    ["task_lost", "task_new", "task_old"],
  );
  assert.equal(projected.runs[0]?.needsRecovery, true);
});

test("projects force-kill and removal safety from explicit statuses", () => {
  const projected = projectTaskPanel(
    [],
    [
      run("task_recovered", { status: "recovered" }),
      run("task_stopping", { status: "stopping" }),
      run("task_unknown", { status: "recovery_unknown" }),
      run("task_done", { status: "cancelled" }),
    ],
  );
  const entries = new Map(projected.runs.map((entry) => [entry.key, entry]));

  assert.equal(entries.get("task_recovered")?.canForceKill, true);
  assert.equal(entries.get("task_stopping")?.canForceKill, true);
  assert.equal(entries.get("task_unknown")?.canForceKill, false);
  assert.equal(entries.get("task_unknown")?.isRemovable, false);
  assert.equal(entries.get("task_done")?.isRemovable, true);
});

test("labels definitions by their label and runs by display name, then command", () => {
  const projected = projectTaskPanel(
    [definition()],
    [
      run("task_a", { definitionId: "taskdef_a", displayName: "api" }),
      run("task_b", { displayName: "api" }),
      run("task_c"),
    ],
  );
  assert.deepEqual(taskDefinitionLabel(projected.definitions[0]!), {
    text: "Web",
    isCommand: false,
  });

  const byId = new Map(
    [...projected.definitions[0]!.runs, ...projected.runs].map((entry) => [
      entry.key,
      entry,
    ]),
  );
  assert.deepEqual(taskRunLabel(byId.get("task_a")!), {
    text: "api",
    isCommand: false,
  });
  assert.deepEqual(taskRunLabel(byId.get("task_b")!), {
    text: "api",
    isCommand: false,
  });
  assert.deepEqual(taskRunLabel(byId.get("task_c")!), {
    text: "pnpm dev",
    isCommand: true,
  });
});
