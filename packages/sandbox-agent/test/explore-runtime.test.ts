import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ExploreRuntime } from "../src/agent/explore-runtime.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

function config(provider = "nerve-scripted-explore") {
  return {
    version: 1,
    identity: { sandboxId: "sbx_explore" },
    agent: {
      defaultModel: { provider, model: "scripted-fast" },
      defaultExploreModel: { provider, model: "scripted-fast" },
      maxExploreDepth: 2,
    },
    controller: {
      websocket: { url: "ws://manager.invalid/ws" },
      auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    },
    tools: {
      groups: {
        fileInspection: { enabled: true },
        explore: { enabled: true, maxDepth: 2, maxParallel: 1 },
      },
    },
  } as const;
}

describe("explore runtime", () => {
  it("does not start a child harness for an already-aborted parent", async () => {
    const abort = new AbortController();
    abort.abort();
    let createCalls = 0;
    const runtime = new ExploreRuntime({
      config: config(),
      createChildHarness: async () => {
        createCalls += 1;
        return undefined as never;
      },
    });

    await assert.rejects(
      runtime.execute({
        conversationId: "conv_abort",
        agentId: "agent_abort",
        runId: "run_abort",
        task: "Do not start",
        signal: abort.signal,
      }),
    );
    assert.equal(createCalls, 0);
  });

  it("cancels active child exploration when the parent run is cancelled", async () => {
    const provider = "nerve-scripted-explore-cancel";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "explore_cancel",
          name: "explore",
          args: {
            tasks: [{ task: "Wait until the parent run cancellation arrives" }],
            context:
              "Parent already confirmed this is a cancellation test and the child should wait until the abort signal is delivered.",
          },
        },
        { type: "waitForAbort" },
      ],
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-explore-cancel-"));
    try {
      const stores = new SandboxStateStores(dir);
      await stores.load();
      const daemon = new SandboxDaemon(
        config(provider),
        "sha256:test",
        "inst_1",
        stores,
        {
          workspaceDir: process.cwd(),
        },
      );
      daemon.start();
      const start = (await daemon.router.dispatch("run.start", {
        requestId: "cmd_explore_cancel",
        text: "Please explore and wait",
      })) as { conversationId: string; agentId: string; runId: string };
      await waitForRelationship(dir, start.conversationId, start.agentId);
      await daemon.router.dispatch("run.cancel", {
        ...start,
        requestId: "cmd_cancel_explore",
        reason: "test cancellation",
      });
      await waitForRun(daemon, start.runId, "cancelled");
      const relationship = await waitForRelationship(
        dir,
        start.conversationId,
        start.agentId,
        "cancelled",
      );
      assert.equal(relationship.status, "cancelled");
    } finally {
      registration.unregister();
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
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

async function waitForRelationship(
  dir: string,
  conversationId: string,
  agentId: string,
  status?: string,
): Promise<{ status: string }> {
  const relDir = path.join(
    dir,
    "conversations",
    conversationId,
    "agents",
    agentId,
    "relationships",
  );
  const deadline = Date.now() + 5_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const [relFile] = await readdir(relDir);
      if (relFile) {
        const relationship = JSON.parse(
          await readFile(path.join(relDir, relFile), "utf8"),
        ) as { status: string };
        last = relationship;
        if (!status || relationship.status === status) return relationship;
      }
    } catch {
      // not created yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for relationship ${status ?? "created"}; last=${JSON.stringify(last)}`,
  );
}
