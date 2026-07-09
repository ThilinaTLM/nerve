import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/agent";
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
      assert.ok((await readFile(toolFile, "utf8")).includes("ask_1"));
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
    } finally {
      registration.unregister();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

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
