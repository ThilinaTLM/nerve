import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { sandboxConfigDigest } from "../src/config/digest.js";
import { Redactor } from "../src/security/redaction.js";
import { FileRpcIdempotencyStore } from "../src/state/rpc-idempotency-store.js";
import { SandboxStateCorruptionError } from "../src/state/corruption.js";
import { EventOutbox } from "../src/state/event-outbox.js";
import { StateLock } from "../src/state/file-lock.js";
import { recoverSandboxState } from "../src/state/recovery.js";
import { resolveSandboxRuntimePaths } from "../src/state/state-layout.js";
import {
  initializeSandboxState,
  SandboxStateError,
} from "../src/state/state-store.js";

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

  it("persists RPC idempotency outcomes and event ack state", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-sandbox-agent-state-"),
    );
    try {
      const records = path.join(dir, "idempotency", "records.jsonl");
      const conflicts = path.join(dir, "idempotency", "conflicts.jsonl");
      const store = new FileRpcIdempotencyStore(records, conflicts);
      await store.load();
      let executions = 0;
      const first = await store.execute(
        "sandbox_manager:manager-1",
        "key-1",
        "run.start",
        { text: "hi" },
        async () => {
          executions += 1;
          return { status: "success", result: { accepted: true } };
        },
      );
      assert.equal(first.status, "executed");
      const duplicate = await store.execute(
        "sandbox_manager:manager-1",
        "key-1",
        "run.start",
        { text: "hi" },
        async () => {
          executions += 1;
          return { status: "success", result: { accepted: false } };
        },
      );
      assert.equal(duplicate.status, "replayed");
      assert.equal(executions, 1);
      const conflict = await store.execute(
        "sandbox_manager:manager-1",
        "key-1",
        "run.start",
        { text: "different" },
        async () => ({ status: "success", result: {} }),
      );
      assert.equal(conflict.status, "conflict");

      const reloaded = new FileRpcIdempotencyStore(records, conflicts);
      await reloaded.load();
      const afterRestart = await reloaded.execute(
        "sandbox_manager:manager-1",
        "key-1",
        "run.start",
        { text: "hi" },
        async () => ({ status: "success", result: { accepted: false } }),
      );
      assert.equal(afterRestart.status, "replayed");

      let failedExecutions = 0;
      const failed = await reloaded.execute(
        "sandbox_manager:manager-1",
        "key-error",
        "run.continue",
        { runId: "run_1" },
        async () => {
          failedExecutions += 1;
          return {
            status: "error",
            error: {
              code: "INTERNAL_ERROR",
              message: "bounded failure",
              retryable: true,
            },
          };
        },
      );
      assert.equal(failed.status, "executed");
      const failedRetry = await reloaded.execute(
        "sandbox_manager:manager-1",
        "key-error",
        "run.continue",
        { runId: "run_1" },
        async () => {
          failedExecutions += 1;
          return { status: "success", result: {} };
        },
      );
      assert.equal(failedRetry.status, "replayed");
      assert.equal(failedExecutions, 1);

      const outbox = new EventOutbox(
        path.join(dir, "outbox.jsonl"),
        path.join(dir, "ack.json"),
      );
      await outbox.load();
      await outbox.append({
        type: "run.started",
        durability: "durable",
        data: {
          conversationId: "conv_1",
          agentId: "agent_1",
          projectId: "proj_1",
          runId: "run_1",
          startedAt: new Date().toISOString(),
        },
      });
      await outbox.append({
        type: "run.delta",
        durability: "transient",
        data: {
          conversationId: "conv_1",
          agentId: "agent_1",
          runId: "run_1",
          deltaId: "delta_1",
          role: "assistant",
          text: "working",
        },
      });
      assert.equal(outbox.all().length, 2);
      let transientDeliveries = 0;
      const unsubscribe = outbox.subscribe((record) => {
        if (record.durability === "transient") transientDeliveries += 1;
      });
      for (let index = 0; index < 1_000; index += 1) {
        await outbox.append({
          type: "run.delta",
          durability: "transient",
          data: {
            conversationId: "conv_1",
            agentId: "agent_1",
            runId: "run_1",
            deltaId: `delta_bulk_${index}`,
            role: "assistant",
            text: "working",
          },
        });
      }
      unsubscribe();
      assert.equal(transientDeliveries, 1_000);
      assert.equal(outbox.all().length, 257);
      assert.equal(outbox.unacked(0).length, 1);
      assert.equal(outbox.unacked(0).length, 1);
      const ack = await outbox.ack("sandbox", 1);
      assert.equal(ack.streams[0]?.processedSeq, 1);
      const staleAck = await outbox.ack("sandbox", 0);
      assert.equal(staleAck.streams[0]?.processedSeq, 1);
      const reloadedOutbox = new EventOutbox(
        path.join(dir, "outbox.jsonl"),
        path.join(dir, "ack.json"),
      );
      await reloadedOutbox.load();
      assert.equal(reloadedOutbox.all().length, 1);
      assert.equal(reloadedOutbox.unacked(0).length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("initializes the v3 state layout and fails closed on corrupt event journals", async () => {
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
          defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
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

      await writeFile(path.join(paths.eventsDir, "outbox.jsonl"), "{bad\n");
      await assert.rejects(
        () => recoverSandboxState(digest, paths),
        (error) =>
          error instanceof SandboxStateCorruptionError && error.exitCode === 30,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects incompatible state with one reset instruction", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-sandbox-agent-version-"),
    );
    try {
      const paths = resolveSandboxRuntimePaths({
        NERVE_SANDBOX_AGENT_STATE_DIR: path.join(dir, "state"),
        NERVE_SANDBOX_AGENT_WORKSPACE_DIR: path.join(dir, "workspace"),
      });
      await mkdir(paths.stateDir, { recursive: true });
      await writeFile(
        path.join(paths.stateDir, "VERSION"),
        '{"format":"nerve-sandbox-agent-state","version":0}\n',
      );
      const config = {
        version: 1,
        agent: {
          defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
        },
        controller: {
          websocket: { url: "wss://manager.example.test/ws" },
          auth: { type: "api_key", apiKey: { env: "TOKEN" } },
        },
      } as const;
      await assert.rejects(
        () =>
          initializeSandboxState(
            config,
            sandboxConfigDigest(config),
            "/config/sandbox.yaml",
            paths,
          ),
        (error) =>
          error instanceof SandboxStateError &&
          error.exitCode === 11 &&
          error.message ===
            `Incompatible sandbox agent state at ${paths.stateDir}. Reset this directory before starting Nerve Protocol v1.`,
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
