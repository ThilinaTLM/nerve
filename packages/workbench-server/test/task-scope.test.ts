import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskRecord, TaskStatus } from "@nervekit/contracts";
import {
  activeBackgroundTaskIdsInDirectoryTree,
  isPathInDirectoryTree,
} from "../src/domains/tasks/index.js";

describe("task directory scope", () => {
  it("includes active background tasks at the project root and below it", () => {
    const tasks = [
      task("task_root", "/workspace/project", "starting"),
      task("task_running", "/workspace/project/apps/api", "running"),
      task("task_ready", "/workspace/project/apps/web", "ready"),
      task("task_stopping", "/workspace/project/tmp", "stopping"),
      task("task_sibling", "/workspace/project-other", "running"),
      task("task_parent", "/workspace", "running"),
      task("task_terminal", "/workspace/project", "completed"),
      task("task_foreground", "/workspace/project", "running", "foreground"),
    ];

    assert.deepEqual(
      activeBackgroundTaskIdsInDirectoryTree(tasks, "/workspace/project"),
      ["task_root", "task_running", "task_ready", "task_stopping"],
    );
  });

  it("uses Windows path semantics for Windows project roots", () => {
    assert.equal(
      isPathInDirectoryTree("C:\\Work\\Project", "C:\\Work\\Project"),
      true,
    );
    assert.equal(
      isPathInDirectoryTree(
        "C:\\Work\\Project",
        "C:\\Work\\Project\\apps\\api",
      ),
      true,
    );
    assert.equal(
      isPathInDirectoryTree("C:\\Work\\Project", "C:\\Work\\Project-other"),
      false,
    );
    assert.equal(isPathInDirectoryTree("C:\\Work\\Project", "C:\\Work"), false);
  });
});

function task(
  id: string,
  cwd: string,
  status: TaskStatus,
  visibility: TaskRecord["visibility"] = "background",
): TaskRecord {
  return {
    id,
    cwd,
    command: "test command",
    status,
    readiness: { outcome: "none" },
    stdoutPath: "/tmp/stdout.log",
    stderrPath: "/tmp/stderr.log",
    logsPath: "/tmp/task.log",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    origin: { kind: "api" },
    visibility,
  };
}
