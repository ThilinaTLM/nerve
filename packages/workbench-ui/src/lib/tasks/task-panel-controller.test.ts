import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PinnedCommand, TaskRecord } from "@nervekit/contracts";
import {
  disabledCapability,
  enabledCapability,
} from "../git/git-panel-types.js";
import {
  createTaskPanelActions,
  groupTasks,
  normalizePinnedCommand,
} from "./task-panel-controller.js";
import type { TaskPanelActions, TaskPanelModel } from "./task-panel-types.js";

function task(id: string, status: TaskRecord["status"]): TaskRecord {
  return {
    id: `task_${id}`,
    cwd: "/workspace",
    command: id,
    status,
    readiness: { outcome: "none" },
    stdoutPath: `/state/${id}.out`,
    stderrPath: `/state/${id}.err`,
    logsPath: `/state/${id}.log`,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    origin: { kind: "api" },
    visibility: "background",
  };
}

function model(enabled: boolean): TaskPanelModel {
  const capability = enabled
    ? enabledCapability
    : disabledCapability("unsupported");
  return {
    availability: { available: true },
    tasks: [],
    defaultCwd: "/workspace",
    pinnedCommands: [],
    pinnedLoading: false,
    logsLoading: false,
    capabilities: {
      start: capability,
      cancel: capability,
      restart: capability,
      remove: capability,
      prune: capability,
      pin: capability,
      copy: capability,
      logs: capability,
      managePinned: capability,
    },
  };
}

function host(calls: string[]): TaskPanelActions {
  const call = (value: string): void => {
    calls.push(value);
  };
  return {
    selectTask: (id) => call(`select:${id}`),
    openTaskOutput: (id) => call(`open:${id}`),
    startTask: (request) => call(`start:${request.command}`),
    runPinned: (command) => call(`run:${command.id}`),
    cancelTask: (id) => call(`cancel:${id}`),
    restartTask: (id) => call(`restart:${id}`),
    removeTask: (id) => call(`remove:${id}`),
    pruneTasks: () => call("prune"),
    pinTask: (value) => call(`pin:${value.id}`),
    copyCommand: (command) => call(`copy:${command}`),
    createPinned: (input) => call(`create:${input.command}`),
    updatePinned: (command) => call(`update:${command.id}`),
    deletePinned: (command) => call(`delete:${command.id}`),
    loadLogs: (id) => call(`logs:${id}`),
  };
}

describe("task panel selectors", () => {
  it("groups active, orphaned, and terminal tasks", () => {
    const groups = groupTasks([
      task("running", "running"),
      task("ready", "ready"),
      task("orphan", "orphaned"),
      task("done", "completed"),
      task("failed", "failed"),
    ]);
    assert.deepEqual(
      groups.running.map((item) => item.id),
      ["task_running", "task_ready"],
    );
    assert.deepEqual(
      groups.orphaned.map((item) => item.id),
      ["task_orphan"],
    );
    assert.deepEqual(
      groups.finished.map((item) => item.id),
      ["task_done", "task_failed"],
    );
  });

  it("normalizes host-specific pinned command identity", () => {
    const command: PinnedCommand = {
      id: "pin_one",
      projectId: "proj_one",
      command: "pnpm test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.deepEqual(normalizePinnedCommand(command), {
      id: "pin_one",
      label: undefined,
      command: "pnpm test",
      cwd: undefined,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
    });
  });
});

describe("task panel action controller", () => {
  it("forwards action arguments when supported", async () => {
    const calls: string[] = [];
    const actions = createTaskPanelActions(() => model(true), host(calls));
    await actions.cancelTask("task_one");
    await actions.copyCommand("pnpm test");
    assert.deepEqual(calls, ["cancel:task_one", "copy:pnpm test"]);
  });

  it("keeps capability-gated actions inert", async () => {
    const calls: string[] = [];
    const actions = createTaskPanelActions(() => model(false), host(calls));
    await actions.cancelTask("task_one");
    await actions.pruneTasks();
    await actions.copyCommand("secret");
    assert.deepEqual(calls, []);
  });
});
