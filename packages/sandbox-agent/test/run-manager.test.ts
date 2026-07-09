import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { RunManager } from "../src/agent/run-manager.js";
import { RunStateStore } from "../src/agent/run-state-store.js";
import { TranscriptStore } from "../src/agent/transcript-store.js";
import { EventOutbox } from "../src/state/event-outbox.js";

describe("sandbox run manager persistence", () => {
  it("persists run state, transcript, cancel events, and redacts prompts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-run-manager-"));
    try {
      const events = new EventOutbox(
        path.join(dir, "events.jsonl"),
        path.join(dir, "ack.json"),
      );
      await events.load();
      const manager = new RunManager(new RunStateStore(dir), dir, events);
      const run = await manager.start({
        commandId: "cmd_1",
        prompt: "hello sk-abcdefghijklmnopqrstuvwxyz",
      });
      assert.equal(run.status, "queued");
      assert.equal(String(run.prompt).includes("sk-"), false);
      const transcript = await new TranscriptStore(dir).read(run);
      assert.equal(JSON.stringify(transcript).includes("sk-"), false);
      const cancelled = await manager.cancel(run);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(
        events
          .all()
          .map((event) => event.type)
          .includes("run.cancelled"),
        true,
      );
      const recovered = await new RunStateStore(dir).read(run);
      assert.equal(recovered?.status, "cancelled");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
