import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { AgentConfigStore } from "../src/agent/agent-config-store.js";
import { SandboxToolRuntime } from "../src/tools/tool-runtime.js";

const config = {
  version: 1,
  agent: {
    mainModel: {
      provider: "nerve-scripted",
      model: "base",
      thinkingLevel: "off",
    },
    permissionLevel: "autonomous",
  },
  controller: {
    websocket: { url: "ws://127.0.0.1/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
  tools: {
    groups: {
      fileEditing: { enabled: true },
      shell: { requireApproval: "risky" },
    },
  },
} as const;

describe("AgentConfigStore", () => {
  it("persists normalized overlays and computes effective runtime config", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-agent-config-"));
    try {
      const store = new AgentConfigStore(dir);
      await store.load();
      await store.update({
        model: {
          provider: "anthropic",
          model: "claude",
          thinkingLevel: "high",
        },
        mode: "planning",
        permissionLevel: "supervised",
        approvalPolicy: { autoApproveReadOnly: false },
      });
      const recovered = new AgentConfigStore(dir);
      await recovered.load();
      const effective = recovered.effective(config);
      assert.equal(effective.model.provider, "anthropic");
      assert.equal(effective.model.model, "claude");
      assert.equal(effective.model.thinkingLevel, "high");
      assert.equal(effective.mode, "planning");
      assert.equal(effective.permissionLevel, "supervised");
      assert.equal(effective.approvalPolicy.autoApproveReadOnly, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("updates tool permission policy immediately", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-agent-policy-"));
    try {
      const runtime = new SandboxToolRuntime(config, {
        workspaceDir: dir,
        stateDir: dir,
      });
      assert.equal(
        runtime.decide("write", { path: "x", content: "y" }).allowed,
        true,
      );
      runtime.updatePolicy({ permissionLevel: "read_only" });
      assert.equal(
        runtime.decide("write", { path: "x", content: "y" }).allowed,
        false,
      );
      assert.equal(runtime.decide("bash", { command: "ls" }).allowed, true);
      assert.equal(
        runtime.decide("bash", { command: "touch x" }).allowed,
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
