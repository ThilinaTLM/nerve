import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import {
  projectTaskPanelEntries,
  taskEntryLabel,
} from "./task-panel-controller.js";

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

test("projects a saved definition and all concurrent runs as one entry", () => {
  const projected = projectTaskPanelEntries(
    [
      {
        id: "taskdef_a",
        label: "Web",
        command: "pnpm dev",
        runPolicy: "concurrent",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    [
      run("task_a", { definitionId: "taskdef_a" }),
      run("task_b", { definitionId: "taskdef_a" }),
    ],
  );
  assert.equal(projected.tasks.length, 1);
  assert.equal(projected.tasks[0]?.activeRuns.length, 2);
});

test("prefers the definition label, then run display name, then the command", () => {
  const definition = {
    id: "taskdef_a",
    label: "Web",
    command: "pnpm dev",
    runPolicy: "single" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const withDefinition = projectTaskPanelEntries(
    [definition],
    [run("task_a", { definitionId: "taskdef_a", displayName: "api" })],
  ).tasks[0];
  assert.deepEqual(taskEntryLabel(withDefinition!), {
    text: "Web",
    isCommand: false,
  });

  const adHoc = projectTaskPanelEntries(
    [],
    [run("task_b", { displayName: "api" })],
  ).tasks[0];
  assert.deepEqual(taskEntryLabel(adHoc!), { text: "api", isCommand: false });

  const unnamed = projectTaskPanelEntries([], [run("task_c")]).tasks[0];
  assert.deepEqual(taskEntryLabel(unnamed!), {
    text: "pnpm dev",
    isCommand: true,
  });
});

test("keeps completed ad-hoc lineages in history", () => {
  const projected = projectTaskPanelEntries(
    [],
    [
      run("task_old", { status: "completed", restartRootTaskId: "task_old" }),
      run("task_new", { status: "failed", restartRootTaskId: "task_old" }),
    ],
  );
  assert.equal(projected.tasks.length, 0);
  assert.equal(projected.history.length, 1);
  assert.equal(projected.history[0]?.runs.length, 2);
});
