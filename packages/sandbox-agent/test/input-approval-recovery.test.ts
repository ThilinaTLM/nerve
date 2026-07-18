import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
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
      const start = (await daemon.router.dispatch(
        "run.start",
        { text: "Ask me for a value" },
        { idempotencyKey: "cmd_start_wait" },
      )) as { conversationId: string; agentId: string; runId: string };
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
          activeRun?: {
            runId: string;
            status: string;
            queuedPrompts: Array<{ id: string; text: string }>;
          };
          toolCalls: Array<{ id: string; toolName: string; status: string }>;
        };
      };
      assert.equal(waitingConversation.snapshot?.activeRun?.runId, start.runId);
      assert.equal(waitingConversation.snapshot?.activeRun?.status, "waiting");
      assert.deepEqual(
        waitingConversation.snapshot?.activeRun?.queuedPrompts,
        [],
      );
      assert.equal(
        waitingConversation.snapshot?.toolCalls.find(
          (tool) => tool.toolName === "ask_user",
        )?.status,
        "waiting_for_user",
      );

      await daemon.router.dispatch("run.followUp", {
        conversationId: start.conversationId,
        agentId: start.agentId,
        runId: start.runId,
        text: "Use this after my answer",
      });
      const queuedConversation = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: start.conversationId,
          agentId: start.agentId,
          runId: start.runId,
        },
      )) as typeof waitingConversation;
      const queuedPrompt =
        queuedConversation.snapshot?.activeRun?.queuedPrompts[0];
      assert.equal(queuedPrompt?.text, "Use this after my answer");
      assert.match(queuedPrompt?.id ?? "", /^promptq_/);
      assert.ok(queuedPrompt);

      await daemon.router.dispatch("agent.promptQueue.cancel", {
        agentId: start.agentId,
        queuedPromptId: queuedPrompt.id,
      });
      const cancelledQueue = (await daemon.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: start.conversationId,
          agentId: start.agentId,
          runId: start.runId,
        },
      )) as typeof waitingConversation;
      assert.deepEqual(cancelledQueue.snapshot?.activeRun?.queuedPrompts, []);

      const transitionFile = path.join(
        dir,
        "run-runtime",
        "runs",
        start.runId,
        "transitions.jsonl",
      );
      const waitingTransitions = await readFile(transitionFile, "utf8");
      assert.match(waitingTransitions, /"kind":"waiting"/);
      assert.match(waitingTransitions, /"kind":"tool_calls_upserted"/);
      assert.match(waitingTransitions, /"status":"waiting_for_user"/);
      assert.match(waitingTransitions, /"boundary":"suspension"/);

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
      const recoveredConversation = (await recovered.router.dispatch(
        "sandbox.conversation.snapshot.get",
        {
          conversationId: start.conversationId,
          agentId: start.agentId,
          runId: start.runId,
        },
      )) as typeof waitingConversation;
      assert.equal(
        recoveredConversation.snapshot?.activeRun?.runId,
        start.runId,
      );
      assert.equal(
        recoveredConversation.snapshot?.activeRun?.status,
        "waiting",
      );
      assert.deepEqual(
        recoveredConversation.snapshot?.toolCalls.find(
          (tool) => tool.toolName === "ask_user",
        ),
        waitingConversation.snapshot?.toolCalls.find(
          (tool) => tool.toolName === "ask_user",
        ),
      );

      const submit = (await recovered.router.dispatch(
        "userQuestion.answer",
        { questionId: "ask_1", answer: "42" },
        { idempotencyKey: "cmd_submit_wait" },
      )) as { status: string };
      assert.equal(submit.status, "answered");
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

      const completedTransitions = await readFile(transitionFile, "utf8");
      assert.match(completedTransitions, /"kind":"interaction_resolved"/);
      assert.match(completedTransitions, /"kind":"completed"/);
      assert.match(completedTransitions, /"text":"42"/);
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
      const start = (await daemon.router.dispatch(
        "run.start",
        { text: "Run the approval-gated command" },
        { idempotencyKey: "cmd_start_approval" },
      )) as { conversationId: string; agentId: string; runId: string };
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
          activeRun?: { runId: string; status: string };
          toolCalls: Array<{ toolName: string; status: string }>;
        };
      };
      assert.equal(conversation.snapshot?.activeRun?.runId, start.runId);
      assert.equal(conversation.snapshot?.activeRun?.status, "waiting");
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
      if (event.type !== "toolCall.updated") return false;
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
