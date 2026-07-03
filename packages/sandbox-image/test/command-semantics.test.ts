import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/shared";
import { SandboxCommandError } from "../src/daemon/errors.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

const baseConfig = {
  version: 1,
  identity: { sandboxId: "sbx_cmd" },
  agent: { mainModel: { provider: "anthropic", model: "claude" } },
  controller: {
    websocket: { url: "ws://manager.invalid/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("sandbox daemon command semantics", () => {
  it("returns UI-ready status and snapshot contracts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-daemon-status-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        baseConfig,
        "sha256:test",
        "inst_1",
        stores,
      );
      daemon.start();
      const status = await daemon.router.dispatch("sandbox.status.get", {});
      assert.equal(
        sandboxStatusGetResultSchema.safeParse(status).success,
        true,
      );
      const snapshot = await daemon.router.dispatch("sandbox.snapshot.get", {});
      assert.equal(
        sandboxSnapshotResultSchema.safeParse(snapshot).success,
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replays duplicate completed command IDs and rejects conflicting params", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-command-idem-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        {
          ...baseConfig,
          agent: { mainModel: { provider: "nerve-faux", model: "faux-fast" } },
        } as never,
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const first = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_idem_start",
        prompt: "hello",
      })) as { runId: string };
      const duplicate = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_idem_start",
        prompt: "hello",
      })) as { runId: string };
      assert.equal(duplicate.runId, first.runId);
      await assert.rejects(
        () =>
          daemon.router.dispatch("sandbox.run.start", {
            commandId: "cmd_idem_start",
            prompt: "different",
          }),
        (error) =>
          error instanceof SandboxCommandError &&
          error.code === "IDEMPOTENCY_CONFLICT",
      );
      await waitForRun(daemon, first.runId, "completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires a run prompt unless the agent has an initial prompt", async () => {
    const daemon = new SandboxDaemon(baseConfig, "sha256:test", "inst_1");
    await assert.rejects(
      () => daemon.router.dispatch("sandbox.run.start", { commandId: "cmd_1" }),
      (error) =>
        error instanceof SandboxCommandError &&
        error.code === "VALIDATION_FAILED",
    );

    const withInitialPrompt = new SandboxDaemon(
      {
        ...baseConfig,
        agent: {
          ...baseConfig.agent,
          initialPrompt: "Use this fallback prompt",
        },
      },
      "sha256:test",
      "inst_2",
    );
    const result = (await withInitialPrompt.router.dispatch(
      "sandbox.run.start",
      {
        commandId: "cmd_2",
      },
    )) as { status?: string };
    assert.equal(result.status, "queued");
  });
});

async function waitForRun(
  daemon: SandboxDaemon,
  runId: string,
  terminal: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = (await daemon.router.dispatch("sandbox.status.get", {})) as {
      runs: Array<{ runId: string; status: string }>;
    };
    const run = status.runs.find((entry) => entry.runId === runId);
    if (run?.status === terminal) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${runId} to become ${terminal}`);
}
