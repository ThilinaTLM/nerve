import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_EVENT_MAX_CONTENT_BYTES,
  PUBLIC_EVENT_MAX_STRING_CHARS,
  validatePublicEvent,
} from "../../src/events/index.js";
import { launchEventDefinitions } from "../../src/domains/launches/events.js";

function launch(command: string) {
  return {
    id: "launch_content",
    cwd: "/workspace",
    command,
    status: "failed",
    readiness: { outcome: "pending" },
    stdoutPath: "/tmp/launch.stdout",
    stderrPath: "/tmp/launch.stderr",
    logsPath: "/tmp/launch.logs",
    startedAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
}

function payload(command: string) {
  return { launch: launch(command) };
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
      ) as { launch: { command: string } };
      assert.equal(parsed.launch.command, command, name);
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
          launch: {
            ...launch("echo safe"),
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
          launchId: "launch_content",
          stream: "stdout",
          text: "x".repeat(PUBLIC_EVENT_MAX_STRING_CHARS + 1),
        },
        "workbench_server",
      ),
    );
  });
});
