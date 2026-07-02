import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SecretResolutionError,
  SecretResolver,
} from "../src/credentials/secret-resolver.js";
import { ApprovalWaiter } from "../src/tools/approval-waiter.js";
import { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

const config = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
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
      await symlink(outside, path.join(workspace, "link"));
      const runtime = new SandboxToolRuntime(config, {
        workspaceDir: workspace,
        stateDir: state,
      });
      assert.equal(
        runtime.decide("write", { path: "x", content: "y" }).allowed,
        false,
      );
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

  it("enforces secret resolver TLS/local policy and recursion", async () => {
    const bad = {
      ...config,
      secretStores: {
        defaultStore: "main",
        stores: { main: { type: "http_kv", endpoint: "http://example.com" } },
      },
    } as never;
    await assert.rejects(
      () => new SecretResolver(bad).resolve({ kv: { key: "x" } }),
      SecretResolutionError,
    );
  });
});
