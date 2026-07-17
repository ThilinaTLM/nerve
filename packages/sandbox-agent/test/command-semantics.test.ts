import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import {
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/contracts";
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
          agent: {
            defaultModel: { provider: "nerve-faux", model: "faux-fast" },
          },
        } as never,
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const first = (await daemon.router.dispatch("run.start", {
        requestId: "cmd_snapshot_first",
        text: "first prompt",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, first.runId, "completed");
      const second = (await daemon.router.dispatch("run.start", {
        requestId: "cmd_snapshot_second",
        conversationId: first.conversationId,
        agentId: first.agentId,
        text: "second prompt",
      })) as { conversationId: string; agentId: string; runId: string };
      assert.notEqual(second.runId, first.runId);
      assert.equal(second.conversationId, first.conversationId);
      assert.equal(second.agentId, first.agentId);

      await waitForRun(daemon, second.runId, "completed");
      const result = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: second.conversationId,
          agentId: second.agentId,
          runId: second.runId,
        },
      )) as {
        snapshot?: {
          entries: Array<{ role: string; text: string }>;
          activeRun?: unknown;
        };
      };

      assert.deepEqual(
        result.snapshot?.entries
          .filter((entry) => entry.role === "user")
          .map((entry) => entry.text),
        ["first prompt", "second prompt"],
      );
      assert.equal(result.snapshot?.activeRun, undefined);
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
            defaultModel: { provider, model: "scripted-fast" },
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
        requestId: "cmd_rich_bash",
        text: "Run the scripted bash tool",
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

      const events = stores.events.all();
      const draftStarted = events.find(
        (event) => event.type === "conversation.live.tool_draft.started",
      );
      const draftDone = events.find(
        (event) => event.type === "conversation.live.tool_draft.done",
      );
      assert.ok(draftStarted);
      assert.ok(draftDone);
      assert.equal(draftDone.data.turnId, toolCall?.turnId);
      assert.equal(draftDone.data.liveMessageId, toolCall?.liveMessageId);
      assert.equal(draftDone.data.contentIndex, toolCall?.contentIndex);
      const liveOutput = events.find(
        (event) => event.type === "conversation.live.tool_output.delta",
      );
      assert.match(
        String((liveOutput?.data as { delta?: unknown } | undefined)?.delta),
        /sandbox rich output/,
      );
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("executes inline command prompts without starting the agent loop", async () => {
    const provider = "nerve-scripted-inline-command";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [{ type: "assistantText", text: "AGENT_LOOP_STARTED" }],
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-inline-command-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        {
          ...baseConfig,
          agent: {
            defaultModel: { provider, model: "scripted-fast" },
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
        requestId: "cmd_inline_only",
        text: "!printf 'sandbox command only\\n'",
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
          entries: Array<{ role: string; text: string }>;
          toolCalls: Array<{
            toolName: string;
            argsPreview?: unknown;
            resultPreview?: unknown;
          }>;
        };
      };
      const transcript = result.snapshot?.entries
        .map((entry) => entry.text)
        .join("\n");
      assert.match(transcript ?? "", /sandbox command only/);
      assert.doesNotMatch(transcript ?? "", /AGENT_LOOP_STARTED/);
      assert.equal(
        result.snapshot?.entries.some((entry) => entry.role === "assistant"),
        false,
      );
      const bash = result.snapshot?.toolCalls.find(
        (toolCall) => toolCall.toolName === "bash",
      );
      assert.equal(
        (bash?.argsPreview as { command?: string } | undefined)?.command,
        "printf 'sandbox command only\\n'",
      );
    } finally {
      registration.unregister();
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

  it("preserves transcript entry details in conversation snapshots", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-entry-details-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        {
          ...baseConfig,
          agent: {
            defaultModel: { provider: "nerve-faux", model: "faux-fast" },
          },
        } as never,
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const command = "printf 'details preserved\\n'";
      const run = (await daemon.router.dispatch("run.start", {
        requestId: "cmd_details",
        text: `!${command}`,
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
          entries: Array<{ role: string; details?: unknown }>;
        };
      };
      const entry = result.snapshot?.entries.find(
        (candidate) => candidate.role === "system",
      );
      assert.deepEqual(entry?.details, {
        type: "inline_command_result",
        command,
      });
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
