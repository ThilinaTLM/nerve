import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import type { TaskRunEntry } from "$lib/features/tasks/views/task-panel-types";
import {
  definitionRowDetail,
  definitionRowSignal,
  finishedRunIds,
  splitRunEntries,
  taskRunSignal,
} from "./mobile-task-rows.js";

function definition(patch: { label?: string; cwd?: string } = {}) {
  return {
    definition: {
      id: "d1",
      command: "pnpm dev",
      createdAt: "",
      updatedAt: "",
      runPolicy: "single" as const,
      ...patch,
    },
  };
}

test("maps run status families onto row signals", () => {
  for (const status of ["starting", "running", "stopping"] as const) {
    assert.deepEqual(taskRunSignal(status), { tone: "info", pulse: true });
  }
  assert.deepEqual(taskRunSignal("ready"), { tone: "success", pulse: false });
  assert.deepEqual(taskRunSignal("recovered").tone, "warning");
  for (const status of ["failed", "timed_out", "orphaned"] as const) {
    assert.equal(taskRunSignal(status).tone, "destructive");
  }
  for (const status of ["completed", "cancelled", "interrupted"] as const) {
    assert.equal(taskRunSignal(status).tone, "neutral");
  }
  assert.equal(definitionRowSignal({}), undefined);
  assert.equal(
    definitionRowSignal({ latestRun: { status: "ready" } as TaskRecord })?.tone,
    "success",
  );
});

test("details a saved task with its command or project-relative folder", () => {
  assert.equal(
    definitionRowDetail(definition({ label: "web" }), "/repo"),
    "pnpm dev",
  );
  assert.equal(definitionRowDetail(definition(), "/repo"), undefined);
  assert.equal(
    definitionRowDetail(definition({ cwd: "/repo/apps/web" }), "/repo/"),
    "apps/web",
  );
  assert.equal(
    definitionRowDetail(definition({ cwd: "/repo" }), "/repo"),
    undefined,
  );
  assert.equal(
    definitionRowDetail(definition({ cwd: "packages/ui" }), "/repo"),
    "packages/ui",
  );
  assert.equal(
    definitionRowDetail(definition({ cwd: "/repository" }), "/repo"),
    "/repository",
  );
});

test("splits ad-hoc runs into running and recent", () => {
  const entry = (key: string, isActive: boolean) =>
    ({ key, isActive }) as TaskRunEntry;
  const split = splitRunEntries([
    entry("a", true),
    entry("b", false),
    entry("c", true),
  ]);
  assert.deepEqual(
    split.running.map((item) => item.key),
    ["a", "c"],
  );
  assert.deepEqual(
    split.recent.map((item) => item.key),
    ["b"],
  );
});

test("collects this screen's finished runs across saved tasks and ad-hoc runs", () => {
  const entry = (id: string, isRemovable: boolean) =>
    ({ run: { id }, isRemovable }) as TaskRunEntry;
  assert.deepEqual(
    finishedRunIds({
      runs: [entry("adhoc-done", true), entry("adhoc-live", false)],
      definitions: [
        { runs: [entry("saved-done", true), entry("saved-live", false)] },
      ],
    }),
    ["adhoc-done", "saved-done"],
  );
});
