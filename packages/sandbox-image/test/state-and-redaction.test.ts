import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Redactor } from "../src/security/redaction.js";
import { CommandInbox } from "../src/state/command-inbox.js";
import { EventOutbox } from "../src/state/event-outbox.js";
import { StateLock } from "../src/state/file-lock.js";

describe("sandbox image durable state foundations", () => {
  it("enforces a single state lock", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-sandbox-lock-"));
    try {
      const lock = await StateLock.acquire(dir);
      await assert.rejects(() => StateLock.acquire(dir), /already held/);
      await lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists command idempotency and event ack state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-sandbox-state-"));
    try {
      const inbox = new CommandInbox(path.join(dir, "commands.jsonl"));
      await inbox.load();
      const first = await inbox.accept({
        commandId: "cmd_1",
        messageId: "msg_1",
        method: "sandbox.run.start",
        params: { commandId: "cmd_1", prompt: "hi" },
      });
      assert.equal(first.duplicate, false);
      const duplicate = await inbox.accept({
        commandId: "cmd_1",
        messageId: "msg_2",
        method: "sandbox.run.start",
        params: { prompt: "hi", commandId: "cmd_1" },
      });
      assert.equal(duplicate.duplicate, true);
      await assert.rejects(
        () =>
          inbox.accept({
            commandId: "cmd_1",
            messageId: "msg_3",
            method: "sandbox.run.start",
            params: { commandId: "cmd_1", prompt: "different" },
          }),
        /IDEMPOTENCY_CONFLICT/,
      );

      await inbox.complete("cmd_1", { ok: true });
      const duplicateWithResult = await inbox.accept({
        commandId: "cmd_1",
        messageId: "msg_4",
        method: "sandbox.run.start",
        params: { prompt: "hi", commandId: "cmd_1" },
      });
      assert.equal(duplicateWithResult.result?.status, "completed");

      const outbox = new EventOutbox(
        path.join(dir, "outbox.jsonl"),
        path.join(dir, "ack.json"),
      );
      await outbox.load();
      await outbox.append({
        type: "run.started",
        durability: "durable",
        data: {},
      });
      assert.equal(outbox.unacked(0).length, 1);
      const ack = await outbox.ack("sandbox", 1);
      assert.equal(ack.streams[0]?.processedSeq, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts common secret fields and token shapes", () => {
    const redacted = new Redactor({ secrets: ["literal-secret"] }).redact({
      token: "literal-secret",
      text: "sk-abcdefghijklmnopqrstuvwxyz",
    });
    assert.deepEqual(redacted, { token: "[REDACTED]", text: "[REDACTED]" });
  });
});
