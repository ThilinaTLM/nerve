import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/agent-runtime";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

function config() {
  return {
    version: 1,
    identity: { sandboxId: "sbx_scripted" },
    agent: {
      defaultModel: { provider: "nerve-scripted", model: "scripted-fast" },
    },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
    tools: { groups: { input: { enabled: true } } },
  } as const;
}

describe("sandbox input wait/recovery with scripted provider", () => {
  it("persists wait/checkpoint, survives daemon reconstruction, resumes, and completes", async () => {
    const registration = registerAgentScriptedProvider({
      steps: [
        {
          type: "toolCall",
          id: "ask_1",
          name: "ask_user",
          args: { question: "Need value?" },
        },
        { type: "assistantText", text: "Thanks for the value." },
      ],
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-input-recovery-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        config(),
        "sha256:test",
        "inst_1",
        stores,
        {
          workspaceDir: process.cwd(),
        },
      );
      daemon.start();
      const start = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_start_wait",
        prompt: "Ask me for a value",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, start.runId, "waiting_for_input");
      await waitForConversationToolStatus(
        stores,
        start.runId,
        "waiting_for_user",
      );

      const waitingStatus = (await daemon.router.dispatch(
        "sandbox.status.get",
        {},
      )) as {
        runs: Array<{
          runId: string;
          toolCalls?: Array<{ toolName: string; status: string }>;
        }>;
      };
      const waitingRun = waitingStatus.runs.find(
        (entry) => entry.runId === start.runId,
      );
      assert.equal(
        waitingRun?.toolCalls?.find((tool) => tool.toolName === "ask_user")
          ?.status,
        "waiting_for_input",
      );

      const waitingConversation = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: start.conversationId,
          agentId: start.agentId,
          runId: start.runId,
        },
      )) as {
        snapshot?: {
          activeRun?: unknown;
          toolCalls: Array<{ toolName: string; status: string }>;
        };
      };
      assert.equal(waitingConversation.snapshot?.activeRun, undefined);
      assert.equal(
        waitingConversation.snapshot?.toolCalls.find(
          (tool) => tool.toolName === "ask_user",
        )?.status,
        "waiting_for_user",
      );

      const toolFile = path.join(
        dir,
        "conversations",
        start.conversationId,
        "agents",
        start.agentId,
        "runs",
        start.runId,
        "tools",
        "tool-calls.jsonl",
      );
      const toolRows = (await readFile(toolFile, "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) => JSON.parse(line) as { toolCallId: string; status: string },
        )
        .filter((row) => row.toolCallId === "ask_1");
      assert.deepEqual(
        toolRows.map((row) => row.status),
        ["requested", "started", "waiting_for_input"],
        "the harness bridge is the single structured lifecycle writer",
      );
      const checkpointDir = path.join(
        dir,
        "conversations",
        start.conversationId,
        "agents",
        start.agentId,
        "runs",
        start.runId,
        "checkpoints",
      );
      await stat(checkpointDir);

      const recoveredStores = new SandboxStateStores(dir);
      await recoveredStores.load();
      const recovered = new SandboxDaemon(
        config(),
        "sha256:test",
        "inst_2",
        recoveredStores,
        { workspaceDir: process.cwd() },
      );
      recovered.start();
      const submit = (await recovered.router.dispatch("sandbox.input.submit", {
        commandId: "cmd_submit_wait",
        conversationId: start.conversationId,
        agentId: start.agentId,
        runId: start.runId,
        requestId: "ask_1",
        text: "42",
      })) as { status: string };
      assert.equal(submit.status, "queued");
      await waitForRun(recovered, start.runId, "completed");

      const status = (await recovered.router.dispatch(
        "sandbox.status.get",
        {},
      )) as {
        runs: Array<{
          runId: string;
          executions?: unknown[];
          checkpoints?: unknown[];
        }>;
      };
      const run = status.runs.find((entry) => entry.runId === start.runId);
      assert.ok(run?.executions?.length);
      assert.ok(run?.checkpoints?.length);

      const harnessConversation = await readFile(
        path.join(
          dir,
          "conversations",
          start.conversationId,
          "agents",
          start.agentId,
          "conversation.jsonl",
        ),
        "utf8",
      );
      assert.match(harnessConversation, /"role":"toolResult"/);
      assert.match(harnessConversation, /"toolCallId":"ask_1"/);
      assert.match(harnessConversation, /"response":"42"/);
      const transcript = await readFile(
        path.join(
          dir,
          "conversations",
          start.conversationId,
          "agents",
          start.agentId,
          "runs",
          start.runId,
          "transcript.jsonl",
        ),
        "utf8",
      );
      assert.doesNotMatch(transcript, /"role":"user"[^\n]*"42"/);
      const completedTools = await readFile(toolFile, "utf8");
      assert.match(completedTools, /"response":"42"/);
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("projects approval suspensions as actionable pending tool calls", async () => {
    const registration = registerAgentScriptedProvider({
      steps: [
        {
          type: "toolCall",
          id: "approval_1",
          name: "bash",
          args: { command: "rm -rf .nerve-approval-test-nonexistent" },
        },
      ],
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-approval-wait-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        config(),
        "sha256:test",
        "inst_1",
        stores,
        { workspaceDir: process.cwd() },
      );
      daemon.start();
      const start = (await daemon.router.dispatch("sandbox.run.start", {
        commandId: "cmd_start_approval",
        prompt: "Run the approval-gated command",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRun(daemon, start.runId, "waiting_for_approval");
      await waitForConversationToolStatus(
        stores,
        start.runId,
        "pending_approval",
      );

      const status = (await daemon.router.dispatch(
        "sandbox.status.get",
        {},
      )) as {
        runs: Array<{
          runId: string;
          toolCalls?: Array<{ toolName: string; status: string }>;
        }>;
      };
      const run = status.runs.find((entry) => entry.runId === start.runId);
      assert.equal(
        run?.toolCalls?.find((tool) => tool.toolName === "bash")?.status,
        "waiting_for_approval",
      );

      const conversation = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: start.conversationId,
          agentId: start.agentId,
          runId: start.runId,
        },
      )) as {
        snapshot?: {
          activeRun?: unknown;
          toolCalls: Array<{ toolName: string; status: string }>;
        };
      };
      assert.equal(conversation.snapshot?.activeRun, undefined);
      assert.equal(
        conversation.snapshot?.toolCalls.find(
          (tool) => tool.toolName === "bash",
        )?.status,
        "pending_approval",
      );
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function waitForConversationToolStatus(
  stores: SandboxStateStores,
  runId: string,
  status: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const found = stores.events.all().some((event) => {
      if (event.type !== "conversation.tool_call.updated") return false;
      const data = event.data as {
        runId?: string;
        toolCall?: { status?: string };
      };
      return data.runId === runId && data.toolCall?.status === status;
    });
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for conversation tool status ${status} in ${runId}`,
  );
}

async function waitForRun(
  daemon: SandboxDaemon,
  runId: string,
  terminal: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const status = (await daemon.router.dispatch("sandbox.status.get", {})) as {
      runs: Array<{ runId: string; status: string }>;
    };
    const run = status.runs.find((entry) => entry.runId === runId);
    last = run;
    if (run?.status === terminal) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${runId} to become ${terminal}; last=${JSON.stringify(last)}`,
  );
}
