import {
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

const baseConfig = {
  version: 1,
  identity: { sandboxId: "sbx_cmd" },
  agent: { defaultModel: { provider: "anthropic", model: "claude" } },
  controller: {
    websocket: { url: "ws://manager.invalid/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
} as const;

describe("sandbox daemon operation semantics", () => {
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

  it("expands executable command blocks before prompting the agent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-command-block-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        {
          ...baseConfig,
          agent: {
            defaultModel: { provider: "nerve-faux", model: "faux-fast" },
            defaultPermissionLevel: "autonomous",
          },
        } as never,
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const run = (await daemon.router.dispatch("run.start", {
        requestId: "cmd_block_expand",
        text: [
          "Summarize this command output:",
          "```!!!",
          "printf 'block output\\n'",
          "```",
        ].join("\n"),
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, run.runId, "completed");

      const result = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: run.conversationId,
          agentId: run.agentId,
          runId: run.runId,
        },
      )) as { snapshot?: { entries: Array<{ role: string; text: string }> } };
      const userEntry = result.snapshot?.entries.find(
        (entry) => entry.role === "user",
      );
      assert.match(userEntry?.text ?? "", /block output/);
      assert.doesNotMatch(userEntry?.text ?? "", /```!!!/);
      const assistantText = result.snapshot?.entries
        .filter((entry) => entry.role === "assistant")
        .map((entry) => entry.text)
        .join("\n");
      assert.match(assistantText ?? "", /block output/);
      assert.doesNotMatch(assistantText ?? "", /```!!!/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires a run prompt", async () => {
    const daemon = new SandboxDaemon(baseConfig, "sha256:test", "inst_1");
    daemon.start();
    await assert.rejects(
      () => daemon.router.dispatch("run.start", {}),
      (error) => error instanceof Error && /text/.test(error.message),
    );
  });
});

async function waitForRun(
  daemon: SandboxDaemon,
  runId: string,
  terminal: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastStatus: string | undefined;
  while (Date.now() < deadline) {
    const status = (await daemon.router.dispatch("sandbox.status.get", {})) as {
      runs: Array<{ runId: string; status: string }>;
    };
    const run = status.runs.find((entry) => entry.runId === runId);
    lastStatus = run?.status;
    if (run?.status === terminal) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${runId} to become ${terminal}; last status: ${lastStatus ?? "missing"}`,
  );
}
