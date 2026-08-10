import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import type { CenterTabModel } from "$lib/features/workspace";
import { tabLabel, tabTitle } from "./editor-tab-helpers.js";

function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task_a",
    cwd: "/repo",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/out",
    stderrPath: "/tmp/err",
    logsPath: "/tmp/logs",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    origin: { kind: "api" },
    visibility: "background",
    ...patch,
  };
}

function tab(record: TaskRecord): Extract<CenterTabModel, { kind: "task" }> {
  return {
    kind: "task",
    id: "taskdef_a",
    task: record,
    active: true,
    sending: true,
  };
}

test("uses a task definition display label for task tabs and titles", () => {
  const model = tab(
    task({ displayName: "Workbench UI", name: "legacy", command: "pnpm dev" }),
  );

  assert.equal(tabLabel(model), "Workbench UI");
  assert.match(tabTitle(model), /^Workbench UI · running ·/);
});

test("falls back from blank display names to name and command", () => {
  assert.equal(tabLabel(tab(task({ displayName: "  ", name: "API" }))), "API");
  assert.equal(
    tabLabel(tab(task({ displayName: " ", name: " ", command: "pnpm test" }))),
    "pnpm test",
  );
});
