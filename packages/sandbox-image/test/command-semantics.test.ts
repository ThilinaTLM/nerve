import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/agent";
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

  it("returns the full conversation transcript when a snapshot targets the latest run", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-conversation-snapshot-"),
    );
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
        commandId: "cmd_snapshot_first",
        prompt: "first prompt",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, first.runId, "completed");
      const second = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_snapshot_second",
        conversationId: first.conversationId,
        agentId: first.agentId,
        behavior: "follow_up",
        prompt: "second prompt",
      })) as { conversationId: string; agentId: string; runId: string };

      await waitForRun(daemon, second.runId, "completed");
      const result = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: second.conversationId,
          agentId: second.agentId,
          runId: second.runId,
        },
      )) as { snapshot?: { entries: Array<{ role: string; text: string }> } };

      assert.deepEqual(
        result.snapshot?.entries
          .filter((entry) => entry.role === "user")
          .map((entry) => entry.text),
        ["first prompt", "second prompt"],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes scripted bash tool calls in conversation snapshots", async () => {
    const provider = "nerve-scripted-rich-bash";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "bash_rich_1",
          name: "bash",
          args: { command: "printf 'sandbox rich output\\n'" },
        },
        { type: "assistantText", text: "Done." },
      ],
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-rich-bash-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        {
          ...baseConfig,
          agent: {
            mainModel: { provider, model: "scripted-fast" },
            permissionLevel: "autonomous",
          },
        } as never,
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const run = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_rich_bash",
        prompt: "Run the scripted bash tool",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, run.runId, "completed");

      const result = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: run.conversationId,
          agentId: run.agentId,
          runId: run.runId,
        },
      )) as {
        snapshot?: {
          toolCalls: Array<{
            providerToolCallId?: string;
            turnId?: string;
            liveMessageId?: string;
            contentIndex?: number;
            status: string;
            argsPreview?: unknown;
            resultPreview?: unknown;
          }>;
        };
      };
      const toolCall = result.snapshot?.toolCalls.find(
        (record) => record.providerToolCallId === "bash_rich_1",
      );
      assert.equal(toolCall?.status, "completed");
      assert.equal(
        (toolCall?.argsPreview as { command?: string } | undefined)?.command,
        "printf 'sandbox rich output\\n'",
      );
      assert.match(
        (toolCall?.resultPreview as { content?: string } | undefined)
          ?.content ?? "",
        /sandbox rich output/,
      );
      assert.equal(toolCall?.contentIndex, 0);
      assert.match(toolCall?.turnId ?? "", /^turn_/);
      assert.match(toolCall?.liveMessageId ?? "", /^msg_/);
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves transcript entry details in conversation snapshots", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-entry-details-"));
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
      const run = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_details",
        prompt: "think then answer",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, run.runId, "completed");
      const transcriptPath = path.join(
        dir,
        "conversations",
        run.conversationId,
        "agents",
        run.agentId,
        "runs",
        run.runId,
        "transcript.jsonl",
      );
      await appendFile(
        transcriptPath,
        `${JSON.stringify({
          entryId: "entry_details",
          index: 99,
          role: "assistant",
          content: { text: "final" },
          details: { thinkingBlocks: [{ text: "hidden chain summary" }] },
          createdAt: "2026-07-07T03:10:00.000Z",
        })}\n`,
      );

      const result = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: run.conversationId,
          agentId: run.agentId,
          runId: run.runId,
        },
      )) as {
        snapshot?: { entries: Array<{ id: string; details?: unknown }> };
      };
      const entry = result.snapshot?.entries.find(
        (candidate) => candidate.id === "entry_details",
      );
      assert.deepEqual(entry?.details, {
        thinkingBlocks: [{ text: "hidden chain summary" }],
      });
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
