import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRecord } from "@nervekit/contracts";
import type { CenterTabModel } from "$lib/application/workspace";
import { statusLabel, tabLabel, tabTitle } from "./editor-tab-helpers.js";

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

test("labels embedded Mermaid tabs with their source and block location", () => {
  const model: Extract<CenterTabModel, { kind: "mermaid" }> = {
    kind: "mermaid",
    id: "diagram_a",
    path: "/repo/docs/architecture.md",
    relativePath: "docs/architecture.md",
    name: "architecture.md",
    locator: { ordinal: 1, startLine: 42, fingerprint: "abc" },
    active: true,
    sending: true,
  };

  assert.equal(tabLabel(model), "architecture.md · diagram 2");
  assert.equal(
    tabTitle(model),
    "/repo/docs/architecture.md · Mermaid diagram at line 42",
  );
  assert.equal(statusLabel(model), "Loading diagram");
});

test("falls back from blank display names to name and command", () => {
  assert.equal(tabLabel(tab(task({ displayName: "  ", name: "API" }))), "API");
  assert.equal(
    tabLabel(tab(task({ displayName: " ", name: " ", command: "pnpm test" }))),
    "pnpm test",
  );
});
