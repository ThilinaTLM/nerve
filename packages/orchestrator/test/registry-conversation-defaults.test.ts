import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeSettings } from "../src/infrastructure/storage/index.js";
import { createState } from "./helpers/registry-conversation.js";

describe("RuntimeRegistry conversation defaults", () => {
  it("writes and clears new agent default model settings", async () => {
    const state = await createState("nerve-registry-settings-merge-");
    try {
      const first = await writeSettings(state.storage, {
        defaultModel: { provider: "nerve-faux", modelId: "faux-fast" },
        defaultThinkingLevel: "high",
        lastAgentSelection: {
          model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
          thinkingLevel: "medium",
          mode: "planning",
        },
      });
      assert.deepEqual(first.defaultModel, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(first.defaultThinkingLevel, "high");
      assert.deepEqual(first.lastAgentSelection.model, {
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
      });
      assert.equal(first.lastAgentSelection.permissionLevel, "autonomous");

      const second = await writeSettings(state.storage, {
        defaultModel: null,
        lastAgentSelection: { model: null, permissionLevel: "read_only" },
      });
      assert.equal(second.defaultModel, undefined);
      assert.equal(second.lastAgentSelection.model, undefined);
      assert.equal(second.lastAgentSelection.mode, "planning");
      assert.equal(second.lastAgentSelection.permissionLevel, "read_only");
    } finally {
      state.index.close();
    }
  });

  it("applies configured defaults to new root conversations and agents", async () => {
    const state = await createState("nerve-registry-agent-defaults-");
    try {
      await writeSettings(state.storage, {
        defaultMode: "planning",
        defaultPermissionLevel: "supervised",
        defaultModel: { provider: "nerve-faux", modelId: "faux-fast" },
        defaultThinkingLevel: "off",
      });
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      assert.equal(conversation.mode, "planning");
      assert.equal(conversation.permissionLevel, "supervised");
      assert.deepEqual(agent.model, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(agent.thinkingLevel, "off");
    } finally {
      state.index.close();
    }
  });

  it("uses remembered last selection for new root conversations and agents", async () => {
    const state = await createState("nerve-registry-agent-last-");
    try {
      await writeSettings(state.storage, {
        rememberLastAgentSelection: true,
        lastAgentSelection: {
          mode: "planning",
          permissionLevel: "read_only",
          model: { provider: "nerve-faux", modelId: "faux-fast" },
          thinkingLevel: "off",
        },
      });
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      assert.equal(conversation.mode, "planning");
      assert.equal(conversation.permissionLevel, "read_only");
      assert.deepEqual(agent.model, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(agent.thinkingLevel, "off");
    } finally {
      state.index.close();
    }
  });

  it("lets explicit root agent creation values override settings defaults", async () => {
    const state = await createState("nerve-registry-agent-explicit-");
    try {
      await writeSettings(state.storage, {
        rememberLastAgentSelection: true,
        lastAgentSelection: {
          mode: "planning",
          permissionLevel: "read_only",
          model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
          thinkingLevel: "high",
        },
      });
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
        mode: "coding",
        permissionLevel: "autonomous",
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: "nerve-faux", modelId: "faux-fast" },
        thinkingLevel: "off",
        mode: "coding",
        permissionLevel: "supervised",
      });

      assert.equal(conversation.mode, "coding");
      assert.equal(conversation.permissionLevel, "autonomous");
      assert.equal(agent.mode, "coding");
      assert.equal(agent.permissionLevel, "supervised");
      assert.deepEqual(agent.model, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(agent.thinkingLevel, "off");
    } finally {
      state.index.close();
    }
  });
});
