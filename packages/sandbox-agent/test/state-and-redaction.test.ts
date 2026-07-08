import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { sandboxConfigDigest } from "../src/config/digest.js";
import { Redactor } from "../src/security/redaction.js";
import { CommandInbox } from "../src/state/command-inbox.js";
import { SandboxStateCorruptionError } from "../src/state/corruption.js";
import { EventOutbox } from "../src/state/event-outbox.js";
import { StateLock } from "../src/state/file-lock.js";
import { recoverSandboxState } from "../src/state/recovery.js";
import { resolveSandboxRuntimePaths } from "../src/state/state-layout.js";
import { initializeSandboxState } from "../src/state/state-store.js";

describe("sandbox agent image durable state foundations", () => {
  it("enforces a single state lock", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-sandbox-agent-lock-"),
    );
    try {
      const lock = await StateLock.acquire(dir);
      await assert.rejects(() => StateLock.acquire(dir), /already held/);
      await lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists command idempotency and event ack state", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-sandbox-agent-state-"),
    );
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
      assert.match(first.record.paramsHash, /^sha256:[a-f0-9]{64}$/);
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

      const completed = await inbox.complete("cmd_1", { ok: true });
      assert.match(completed.responseHash ?? "", /^sha256:[a-f0-9]{64}$/);
      const duplicateWithResult = await inbox.accept({
        commandId: "cmd_1",
        messageId: "msg_4",
        method: "sandbox.run.start",
        params: { prompt: "hi", commandId: "cmd_1" },
      });
      assert.equal(duplicateWithResult.result?.status, "completed");

      const reloaded = new CommandInbox(path.join(dir, "commands.jsonl"));
      await reloaded.load();
      assert.equal(reloaded.get("cmd_1")?.paramsHash, first.record.paramsHash);
      assert.equal(reloaded.getResult("cmd_1")?.status, "completed");

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

  it("initializes the v1 state layout and fails closed on corrupt command journals", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-sandbox-agent-recover-"),
    );
    try {
      const paths = resolveSandboxRuntimePaths({
        NERVE_SANDBOX_AGENT_STATE_DIR: path.join(dir, "state"),
        NERVE_SANDBOX_AGENT_WORKSPACE_DIR: path.join(dir, "workspace"),
      });
      const config = {
        version: 1,
        agent: {
          mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
        },
        controller: {
          websocket: { url: "wss://manager.example.test/ws" },
          auth: { type: "api_key", apiKey: { env: "TOKEN" } },
        },
      } as const;
      const digest = sandboxConfigDigest(config);
      await initializeSandboxState(
        config,
        digest,
        "/config/sandbox.yaml",
        paths,
      );
      const recovered = await recoverSandboxState(digest, paths);
      assert.equal(recovered.configDigest, digest);
      assert.equal(recovered.ack.streams.length, 0);
      for (const directory of [
        paths.pnpmHomeDir,
        paths.npmCacheDir,
        paths.npmGlobalDir,
        paths.yarnCacheDir,
      ]) {
        const stats = await stat(directory);
        assert.equal(stats.isDirectory(), true);
        if (process.platform !== "win32")
          assert.equal((stats.mode & 0o700) > 0, true);
      }

      if (process.platform !== "win32")
        assert.equal((await stat(paths.credentialsDir)).mode & 0o777, 0o700);

      await writeFile(path.join(paths.commandsDir, "inbox.jsonl"), "{bad\n");
      await assert.rejects(
        () => recoverSandboxState(digest, paths),
        (error) =>
          error instanceof SandboxStateCorruptionError && error.exitCode === 30,
      );
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
