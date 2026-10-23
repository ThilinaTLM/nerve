import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { scopedConversationCreation } from "./scoped-conversation-creation.js";

async function fixture(requiredModel = false) {
  const home = await mkdtemp(join(tmpdir(), "nerve-scoped-launch-"));
  const project = join(home, "project");
  await mkdir(join(home, "config"), { recursive: true });
  await mkdir(project);
  await writeFile(
    join(home, "config", "agent.json"),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: {
        ...(requiredModel
          ? {}
          : { model: { provider: "test", modelId: "defaults" } }),
        reasoningLevel: "medium",
        permissionRuleSetId: "baseline",
      },
    }),
  );
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => project,
    conversationOwner: (id) => ({
      projectId: "p",
      role: id === "parent" ? "lead" : "child",
    }),
    builtins: {
      worker: JSON.stringify({
        schemaVersion: 1,
        name: "worker",
        usableBy: "subagent",
        description: "Worker",
        instructions: "Worker instructions",
        recommendations: requiredModel
          ? {}
          : { model: { provider: "test", modelId: "recommendation" } },
        requirements: requiredModel
          ? { model: { provider: "test", modelId: "required" } }
          : {},
      }),
    },
    isProfileTrusted: () => false,
    captureResources: () => ({ options: {}, isCurrent: () => true }),
  });
  await service.createConversation("parent", {
    schemaVersion: 1,
    revision: 1,
    appliedProfile: null,
    context: {
      instructions: "Parent-local context",
      systemPrompt: "Parent-only base",
    },
    overrides: {
      model: { provider: "test", modelId: "parent-only" },
      permissionRuleSetId: "planning",
      tools: { subagents: { enabled: true }, jira: { enabled: true } },
      subagents: {
        worker: requiredModel
          ? { enabled: true }
          : {
              enabled: true,
              model: { provider: "test", modelId: "launch" },
              reasoningLevel: "low",
            },
      },
    },
  });
  const creation = scopedConversationCreation(service, async () => {});
  return {
    home,
    service,
    creation,
    close: async () => {
      await service.flushSummaries();
      await rm(home, { recursive: true, force: true });
    },
  };
}

void test("child launch uses only model/reasoning invocation choices, freezes preferences and never copies parent", async () => {
  const f = await fixture();
  try {
    const preflight = await f.creation.childHost.resolveProfile({
      parentId: "parent",
      profile: "worker",
    });
    await f.creation.initializeConversation({
      id: "child",
      projectId: "p",
      parentConversationId: "parent",
      application: preflight.application,
    });
    const before = await f.service.getEffective("child");
    assert.equal(before.status, "available");
    if (before.status !== "available") return;
    assert.equal(before.resolution.settings.model?.modelId, "launch");
    assert.equal(before.resolution.settings.reasoningLevel, "low");
    assert.equal(before.resolution.settings.permissionRuleSetId, "baseline");
    assert.equal(before.resolution.settings.tools?.jira?.enabled, false);
    assert.deepEqual(f.service.getConversationContext("child"), {
      instructions: null,
      systemPrompt: null,
    });
    assert.equal(before.resolution.settings.subagents, undefined);
    assert.equal(before.resolution.settings.tools?.subagents, undefined);
    const state = await f.service.ensureLoaded({ scope: "user" });
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    await f.service.save(
      { scope: "user" },
      {
        expectedRevision: state.value.document.revision,
        expectedDigest: state.value.digest,
        changes: {
          model: { provider: "test", modelId: "new-default" },
          permissionRuleSetId: "autonomous",
        },
        resets: [],
      },
    );
    const after = await f.service.getEffective("child");
    assert.equal(after.status, "available");
    if (after.status === "available")
      assert.deepEqual(after.resolution.settings, before.resolution.settings);
    await assert.rejects(
      f.creation.childHost.usableProfiles("child"),
      /Children cannot delegate/,
    );
  } finally {
    await f.close();
  }
});

void test("required child model supplies a missing underlying model", async () => {
  const f = await fixture(true);
  try {
    const preflight = await f.creation.childHost.resolveProfile({
      parentId: "parent",
      profile: "worker",
    });
    await f.creation.initializeConversation({
      id: "child",
      projectId: "p",
      parentConversationId: "parent",
      application: preflight.application,
    });
    const view = await f.service.getEffective("child");
    assert.equal(view.status, "available");
    if (view.status === "available") {
      assert.equal(view.resolution.settings.model?.modelId, "required");
      const doc = view.sources[0].document;
      assert.ok("frozenDefaults" in doc);
      assert.equal(doc.frozenDefaults.model, undefined);
    }
  } finally {
    await f.close();
  }
});

void test("launch revalidates enablement after preflight instead of trusting advertised names", async () => {
  const f = await fixture();
  try {
    const preflight = await f.creation.childHost.resolveProfile({
      parentId: "parent",
      profile: "worker",
    });
    const state = await f.service.ensureLoaded({
      scope: "conversation",
      conversationId: "parent",
    });
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    await f.service.save(
      { scope: "conversation", conversationId: "parent" },
      {
        expectedRevision: state.value.document.revision,
        expectedDigest: state.value.digest,
        changes: { subagents: { worker: { enabled: false } } },
        resets: [],
      },
    );
    await assert.rejects(
      f.creation.initializeConversation({
        id: "child",
        projectId: "p",
        parentConversationId: "parent",
        application: preflight.application,
      }),
      /disabled/,
    );
  } finally {
    await f.close();
  }
});
void test("D10 child creation stores only explicit local context, separate from profile instructions", async () => {
  const f = await fixture();
  try {
    const launch = await f.creation.childHost.resolveProfile({
      parentId: "parent",
      profile: "worker",
    });
    await f.creation.initializeConversation({
      id: "child",
      projectId: "p",
      parentConversationId: "parent",
      application: launch.application,
      config: {
        instructions: "Child-local context",
        systemPrompt: "Child custom base",
      },
    });
    assert.deepEqual(f.service.getConversationContext("child"), {
      instructions: "Child-local context",
      systemPrompt: "Child custom base",
    });
    const view = await f.service.getEffective("child");
    assert.equal(view.status, "available");
    if (view.status === "available") {
      const document = view.sources.find(
        (source) => source.scope.scope === "conversation",
      )?.document;
      assert(document && "appliedProfile" in document);
      assert.equal(
        document.appliedProfile?.instructions,
        "Worker instructions",
      );
    }
  } finally {
    await f.close();
  }
});
