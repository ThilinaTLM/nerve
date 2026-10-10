import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_EVENT_MAX_CONTENT_BYTES,
  PUBLIC_EVENT_MAX_STRING_CHARS,
  validatePublicEvent,
} from "../../src/events/index.js";
import { launchEventDefinitions } from "../../src/domains/tasks/events.js";

function task(command: string) {
  return {
    id: "task_content",
    cwd: "/workspace",
    command,
    status: "failed",
    readiness: { outcome: "pending" },
    stdoutPath: "/tmp/task.stdout",
    stderrPath: "/tmp/task.stderr",
    logsPath: "/tmp/task.logs",
    startedAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
}

function payload(command: string) {
  return { task: task(command) };
}

describe("launch event content policy", () => {
  it("preserves long commands across every full-record event", () => {
    // Exceeds both the metadata string cap and its 64 KiB total byte cap.
    const command = "echo " + "x".repeat(70_000);
    for (const { name } of launchEventDefinitions) {
      if (["launch.output", "launch.removed"].includes(name)) continue;
      const parsed = validatePublicEvent(
        name,
        payload(command),
        "workbench_server",
      ) as { task: { command: string } };
      assert.equal(parsed.task.command, command, name);
    }
  });

  it("retains the content byte ceiling", () => {
    assert.throws(() =>
      validatePublicEvent(
        "launch.failed",
        payload("x".repeat(PUBLIC_EVENT_MAX_CONTENT_BYTES)),
        "workbench_server",
      ),
    );
  });

  it("retains public-data safety checks", () => {
    assert.throws(() =>
      validatePublicEvent(
        "launch.failed",
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
        "launch.output",
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
