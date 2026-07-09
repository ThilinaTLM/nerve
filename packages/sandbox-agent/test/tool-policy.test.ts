import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SecretResolutionError,
  SecretResolver,
} from "../src/credentials/secret-resolver.js";
import { SecretStoreRegistry } from "../src/secret-stores/secret-store-registry.js";
import { ApprovalWaiter } from "../src/tools/approval-waiter.js";
import { TaskSupervisor } from "../src/tools/task-supervisor.js";
import { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

const config = {
  version: 1,
  agent: {
    defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
  },
  controller: {
    websocket: { url: "ws://127.0.0.1/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
  tools: {
    groups: {
      fileEditing: { enabled: false },
      shell: {
        requireApproval: "risky",
        maxTimeoutMs: 1000,
        envAllowlist: ["SAFE"],
      },
    },
  },
} as const;

function secretResolverForEndpoint(endpoint: string): SecretResolver {
  const registry = new SecretStoreRegistry();
  registry.set("main", { resolve: async () => ({ value: "ok" }) });
  return new SecretResolver(
    {
      ...config,
      secretStores: {
        defaultStore: "main",
        stores: { main: { type: "http_kv", endpoint } },
      },
    } as never,
    registry,
  );
}

describe("sandbox tool policy", () => {
  it("denies disabled tools, path escapes, symlink escapes, and risky commands", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-tool-policy-"));
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      await mkdir(workspace);
      await mkdir(state);
      const outside = path.join(dir, "outside.txt");
      await writeFile(outside, "secret");
      let symlinkCreated = false;
      try {
        await symlink(outside, path.join(workspace, "link"));
        symlinkCreated = true;
      } catch (error) {
        if (process.platform !== "win32") throw error;
      }
      const runtime = new SandboxToolRuntime(config, {
        workspaceDir: workspace,
        stateDir: state,
      });
      assert.equal(
        runtime.decide("write", { path: "x", content: "y" }).allowed,
        false,
      );
      await assert.rejects(
        () => runtime.execute("read", { path: path.join(dir, "outside.txt") }),
        /outside workspace|escapes/,
      );
      if (symlinkCreated)
        await assert.rejects(
          () => runtime.execute("read", { path: path.join(workspace, "link") }),
          /outside workspace|escapes/,
        );
      assert.equal(
        runtime.decide("bash", { command: "rm -rf /workspace" })
          .approvalRequired,
        true,
      );
      await assert.rejects(
        () => runtime.execute("bash", { command: "sleep 2", timeout: 5 }),
        /timeout exceeds/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists approval waits and rejects conflicting resolutions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-approvals-"));
    try {
      const waiter = new ApprovalWaiter(dir);
      await waiter.request({
        id: "approval_1",
        toolCallId: "tool_1",
        reason: "risky",
        risk: ["destructive"],
        normalizedArgs: {},
      });
      assert.equal(
        (await waiter.resolve("approval_1", "grant")).resolved?.decision,
        "grant",
      );
      await assert.rejects(
        () => waiter.resolve("approval_1", "deny"),
        /Conflicting/,
      );
      const recovered = new ApprovalWaiter(dir);
      await recovered.load();
      assert.equal(recovered.list()[0]?.resolved?.decision, "grant");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dispatches supervised task restart through the tool runtime", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-task-runtime-"));
    let supervisor: TaskSupervisor | undefined;
    try {
      const workspace = path.join(dir, "workspace");
      const state = path.join(dir, "state");
      await mkdir(workspace);
      await mkdir(state);
      supervisor = new TaskSupervisor({ stateDir: state });
      const runtime = new SandboxToolRuntime(config, {
        workspaceDir: workspace,
        stateDir: state,
        taskSupervisor: supervisor,
      });
      const started = await runtime.execute("task_start", {
        command: "printf restart-ok",
      });
      const first = (started.details as { task: { id: string } }).task;
      const restarted = await runtime.execute("task_restart", {
        taskId: first.id,
      });
      const second = (restarted.details as { task: { id: string } }).task;
      assert.notEqual(second.id, first.id);
      await runtime.execute("task_cancel", { taskId: second.id });
      await supervisor.drain();
      const persisted = JSON.parse(
        await readFile(
          path.join(state, "tasks", second.id, "state.json"),
          "utf8",
        ),
      ) as { restartedFromTaskId?: string; restartGeneration?: number };
      assert.equal(persisted.restartedFromTaskId, first.id);
      assert.equal(persisted.restartGeneration, 1);
    } finally {
      await supervisor?.drain().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows HTTPS and private-runtime HTTP secret store endpoints", async () => {
    const endpoints = [
      "https://example.com/secrets",
      "http://127.0.0.1:7869/secrets",
      "http://10.0.1.10:7869/secrets",
      "http://172.16.0.5:7869/secrets",
      "http://192.168.1.10:7869/secrets",
      "http://[fd00::1]:7869/secrets",
      "http://sandbox-manager:7869/secrets",
      "http://sandbox-manager.nerve-sandbox-dev.local:7869/secrets",
      "http://sandbox-manager.internal:7869/secrets",
      "http://sandbox-manager.svc.cluster.local:7869/secrets",
    ];
    for (const endpoint of endpoints)
      assert.equal(
        await secretResolverForEndpoint(endpoint).resolve({ kv: { key: "x" } }),
        "ok",
        endpoint,
      );
  });

  it("rejects public or non-HTTP(S) plaintext secret store endpoints", async () => {
    const endpoints = [
      "http://example.com/secrets",
      "http://nerve-sandbox-nonprod-dev-manage-539982571.us-east-2.elb.amazonaws.com/secrets",
      "ftp://sandbox-manager/secrets",
    ];
    for (const endpoint of endpoints)
      await assert.rejects(
        () => secretResolverForEndpoint(endpoint).resolve({ kv: { key: "x" } }),
        SecretResolutionError,
        endpoint,
      );
  });
});
