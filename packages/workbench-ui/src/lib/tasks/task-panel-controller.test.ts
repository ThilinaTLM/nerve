import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import {
  projectTaskPanel,
  taskDefinitionLabel,
  taskLineageRuns,
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
  assert.equal(projected.definitions[0]?.activeRuns.length, 2);
  assert.equal(projected.runs.length, 2);
  assert.deepEqual(
    projected.runs.map((entry) => entry.definition?.id),
    ["taskdef_a", "taskdef_a"],
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

test("prefers the definition label, then run display name, then the command", () => {
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

  const byId = new Map(projected.runs.map((entry) => [entry.key, entry]));
  assert.deepEqual(taskRunLabel(byId.get("task_a")!), {
    text: "Web",
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

test("groups lineage runs by definition, then restart root, then id", () => {
  const tasks = [
    run("task_def_1", { definitionId: "taskdef_a" }),
    run("task_def_2", { definitionId: "taskdef_a" }),
    run("task_root", { restartRootTaskId: "task_root" }),
    run("task_restart", { restartRootTaskId: "task_root" }),
    run("task_solo"),
  ];
  assert.deepEqual(
    taskLineageRuns(tasks, tasks[0])
      .map((task) => task.id)
      .sort(),
    ["task_def_1", "task_def_2"],
  );
  assert.deepEqual(
    taskLineageRuns(tasks, tasks[3])
      .map((task) => task.id)
      .sort(),
    ["task_restart", "task_root"],
  );
  assert.deepEqual(
    taskLineageRuns(tasks, tasks[4]).map((task) => task.id),
    ["task_solo"],
  );
  assert.deepEqual(taskLineageRuns(tasks, undefined), []);
});
