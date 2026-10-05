import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_EVENT_MAX_CONTENT_BYTES,
  PUBLIC_EVENT_MAX_STRING_CHARS,
  validatePublicEvent,
} from "../../src/events/index.js";
import { taskEventDefinitions } from "../../src/domains/tasks/events.js";

function task(command: string) {
  return {
    id: "task_content",
    cwd: "/workspace",
    command,
    status: "interrupted",
    readiness: { outcome: "pending" },
    stdoutPath: "/tmp/task.stdout",
    stderrPath: "/tmp/task.stderr",
    logsPath: "/tmp/task.logs",
    startedAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
}

const runtime = {
  version: 2,
  platform: "linux",
  childPid: 1234,
  detached: true,
  shell: true,
  containment: "process-group",
  spawnedAt: "2026-10-05T00:00:00.000Z",
  identity: { kind: "linux", startTimeTicks: 100 },
  capabilities: { identity: true, processTree: true, listeningPorts: true },
};

function payload(name: string, command: string) {
  return {
    task: task(command),
    ...(name === "task.orphan_cleanup_succeeded"
      ? { runtime, signal: "SIGTERM" }
      : name === "task.cleanup_failed"
        ? { error: "cleanup unavailable", orphaned: true }
        : {}),
  };
}

describe("task event content policy", () => {
  it("preserves long commands across every full-record event", () => {
    // Exceeds both the metadata string cap and its 64 KiB total byte cap.
    const command = "echo " + "x".repeat(70_000);
    for (const { name } of taskEventDefinitions) {
      if (["task.output", "task.removed"].includes(name)) continue;
      const parsed = validatePublicEvent(
        name,
        payload(name, command),
        "workbench_server",
      ) as { task: { command: string } };
      assert.equal(parsed.task.command, command, name);
    }
  });

  it("retains the content byte ceiling", () => {
    assert.throws(() =>
      validatePublicEvent(
        "task.interrupted",
        payload("task.interrupted", "x".repeat(PUBLIC_EVENT_MAX_CONTENT_BYTES)),
        "workbench_server",
      ),
    );
  });

  it("retains public-data safety checks", () => {
    assert.throws(() =>
      validatePublicEvent(
        "task.interrupted",
        {
          task: {
            ...task("echo safe"),
            cwd: "https://user:password@host/path",
          },
        },
        "workbench_server",
      ),
    );
  });

  it("keeps output events on the strict policy", () => {
    assert.throws(() =>
      validatePublicEvent(
        "task.output",
        {
          taskId: "task_content",
          stream: "stdout",
          text: "x".repeat(PUBLIC_EVENT_MAX_STRING_CHARS + 1),
        },
        "workbench_server",
      ),
    );
  });
});
