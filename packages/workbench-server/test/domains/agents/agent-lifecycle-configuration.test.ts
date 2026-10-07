import assert from "node:assert/strict";
import test from "node:test";
import {
  agentRecordSchema,
  resolveAgentBlueprint,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import { AgentLifecycleService } from "../../../src/domains/agents/agent-lifecycle.service.js";

type Dependencies = ConstructorParameters<typeof AgentLifecycleService>;
function fixture() {
  const initial = resolveAgentBlueprint(
    agentRecordSchema.parse({
      id: "agent_child",
      conversationId: "conv_shared",
      projectId: "proj_test",
      rootAgentId: "agent_root",
      parentAgentId: "agent_root",
      projectDir: "/workspace",
      mode: "coding",
      permissionLevel: "supervised",
      permissionRuleSetId: "supervised",
      workspaceScope: { roots: ["/workspace"] },
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    }),
  );
  const agents = new Map([[initial.id, initial]]);
  const writes: AgentRecord[] = [];
  const published: {
    type: string;
    agent: AgentRecord;
    persisted: AgentRecord | undefined;
  }[] = [];
  let failWrite = false;
  let liveUpdates = 0;
  const service = new AgentLifecycleService(
    {} as Dependencies[0],
    {
      publish: async (type: string, data: { agent: AgentRecord }) => {
        published.push({ type, agent: data.agent, persisted: writes.at(-1) });
      },
    } as unknown as Dependencies[1],
    { upsertAgent: () => undefined } as unknown as Dependencies[2],
    {
      agents,
      getAgent: (id: string) => {
        const agent = agents.get(id);
        assert.ok(agent);
        return agent;
      },
    } as unknown as Dependencies[3],
    {
      write: async (agent: AgentRecord) => {
        await Promise.resolve();
        if (failWrite) throw new Error("disk failure");
        writes.push(agent);
      },
    } as unknown as Dependencies[4],
    {} as Dependencies[5],
    async () => undefined,
    async () => undefined,
    async () => "run_active",
    async () => {
      liveUpdates++;
    },
  );
  return {
    service,
    agents,
    writes,
    published,
    initial,
    fail: () => {
      failWrite = true;
    },
    liveUpdates: () => liveUpdates,
  };
}

test("busy children accept complete configuration and serialize accepted revisions without changing an in-flight harness", async () => {
  const { service, initial, writes, liveUpdates } = fixture();
  await Promise.all([
    service.configureAgent(initial.id, {
      mode: "planning",
      instructions: "Review",
      tools: ["read_file"],
      skills: ["review"],
    }),
    service.configureAgent(initial.id, {
      thinkingLevel: "high",
      systemPrompt: "New prompt",
      projectDir: "/workspace/subdir",
    }),
  ]);
  const current = service.getAgent(initial.id);
  assert.equal(current.configurationRevision, 3);
  assert.equal(current.effectiveConfigurationRevision, 0);
  assert.equal(current.mode, "planning");
  assert.equal(current.instructions, "Review");
  assert.equal(current.systemPrompt, "New prompt");
  assert.equal(current.projectDir, "/workspace/subdir");
  assert.deepEqual(current.tools, ["read_file"]);
  assert.deepEqual(current.skills, ["review"]);
  assert.deepEqual(
    writes.map((agent) => agent.configurationRevision),
    [2, 3],
  );
  assert.equal(liveUpdates(), 0);
  await service.setEffectiveConfigurationRevision(initial.id, 2);
  assert.equal(service.getAgent(initial.id).configurationRevision, 3);
  assert.equal(service.getAgent(initial.id).effectiveConfigurationRevision, 2);
  await assert.rejects(
    service.setEffectiveConfigurationRevision(initial.id, 1),
    /non-regressing/,
  );
  await assert.rejects(
    service.setEffectiveConfigurationRevision(initial.id, 4),
    /accepted/,
  );
});

test("failed persistence does not acknowledge or publish uncommitted configuration into runtime state", async () => {
  const { service, initial, agents, fail } = fixture();
  fail();
  await assert.rejects(
    service.configureAgent(initial.id, { instructions: "Not persisted" }),
    /disk failure/,
  );
  assert.deepEqual(agents.get(initial.id), initial);
});

test("activation pause survives configuration changes and does not consume a configuration revision", async () => {
  const { service, initial } = fixture();
  await service.setActivationState(initial.id, "paused");
  assert.equal(service.getAgent(initial.id).configurationRevision, 1);
  await service.configureAgent(initial.id, {
    instructions: "Pending while paused",
  });
  assert.equal(service.getAgent(initial.id).activationState, "paused");
  await service.setActivationState(initial.id, "enabled");
  assert.equal(service.getAgent(initial.id).configurationRevision, 2);
});

test("effective revision adoption publishes an existing event strictly after persistence; failed adoption publishes nothing", async () => {
  const { service, initial, published, fail } = fixture();
  await service.configureAgent(initial.id, { instructions: "Accepted" });
  const acceptedCount = published.length;
  const adopted = await service.setEffectiveConfigurationRevision(
    initial.id,
    2,
  );
  assert.equal(published.length, acceptedCount + 1);
  assert.equal(published.at(-1)?.type, "agent.configured");
  assert.equal(published.at(-1)?.agent.effectiveConfigurationRevision, 2);
  assert.deepEqual(published.at(-1)?.persisted, adopted);
  fail();
  await assert.rejects(
    service.setEffectiveConfigurationRevision(initial.id, 2),
    /disk failure/,
  );
  assert.equal(published.length, acceptedCount + 1);
});

test("skill inheritance and explicitly empty selection survive unrelated updates", async () => {
  const { service, initial } = fixture();
  assert.equal(initial.skills, null);
  await service.configureAgent(initial.id, { skills: [] });
  await service.configureAgent(initial.id, {
    instructions: "Keep skills disabled",
  });
  assert.deepEqual(service.getAgent(initial.id).skills, []);
  await service.configureAgent(initial.id, { skills: null });
  assert.equal(service.getAgent(initial.id).skills, null);
});

test("read-only configuration rejects readonly removal and workspace expansion before normalizing persisted blueprint", async () => {
  const { service, initial, agents, published } = fixture();
  agents.set(initial.id, {
    ...initial,
    readOnlyCeiling: true,
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    workspaceScope: { roots: ["/workspace"], readonly: true },
  });
  await assert.rejects(
    service.configureAgent(initial.id, {
      workspaceScope: { roots: ["/workspace"], readonly: false },
    }),
    /read-only preset/,
  );
  await assert.rejects(
    service.configureAgent(initial.id, { workspaceScope: { roots: ["/"] } }),
    /workspace/,
  );
  await assert.rejects(
    service.configureAgent(initial.id, { projectDir: "/workspace-escape" }),
    /workspace/,
  );
  assert.equal(published.length, 0);
  const valid = await service.configureAgent(initial.id, {
    projectDir: "/workspace/subdir",
    workspaceScope: { roots: ["/workspace/subdir"] },
  });
  assert.equal(valid.workspaceScope.readonly, true);
});

test("parent configuration uses trusted originating ordinary snapshot without gaining from latest edits; live controls still fence delegation", async () => {
  const { service, initial, agents } = fixture();
  const { agentConfigurationSchema } =
    await import("@nervekit/contracts/agents");
  const originalParent = {
    ...initial,
    id: "agent_root",
    parentAgentId: undefined,
    rootAgentId: "agent_root",
    permissionLevel: "autonomous" as const,
    permissionRuleSetId: "autonomous",
    projectDir: "/original",
    workspaceScope: { roots: ["/original"] },
    model: { provider: "original", modelId: "original" },
    configurationRevision: 1,
  };
  const snapshot = {
    agentId: originalParent.id,
    configurationRevision: 1,
    configuration: agentConfigurationSchema.parse(originalParent),
    source: {
      runId: "run_original",
      attemptId: "exec_original",
      toolCallId: "tool_original",
    },
  };
  agents.set(initial.id, {
    ...initial,
    mode: "planning",
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    projectDir: "/original/child",
    workspaceScope: { roots: ["/original/child"] },
  });
  agents.set(originalParent.id, {
    ...originalParent,
    mode: "planning",
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    projectDir: "/new",
    workspaceScope: { roots: ["/new"] },
    model: { provider: "new", modelId: "new" },
    configurationRevision: 2,
  });
  const request = {
    mode: "coding" as const,
    permissionLevel: "autonomous" as const,
    permissionRuleSetId: "autonomous",
  };
  await assert.rejects(
    service.configureAgent(initial.id, request, {
      parentAgentId: originalParent.id,
    }),
    /parent authority/,
  );
  const configured = await service.configureAgent(initial.id, request, {
    parentAgentId: originalParent.id,
    parentConfigurationSnapshot: snapshot,
  });
  assert.equal(configured.mode, "coding");
  assert.equal(configured.permissionLevel, "autonomous");
  agents.set(originalParent.id, {
    ...agents.get(originalParent.id)!,
    activationState: "paused",
  });
  await assert.rejects(
    service.configureAgent(
      initial.id,
      { instructions: "Old batch" },
      {
        parentAgentId: originalParent.id,
        parentConfigurationSnapshot: snapshot,
      },
    ),
    /paused parent/,
  );
  agents.set(originalParent.id, {
    ...originalParent,
    configurationRevision: 2,
    readOnlyCeiling: true,
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    workspaceScope: { roots: ["/original"], readonly: true },
  });
  await assert.rejects(
    service.configureAgent(initial.id, request, {
      parentAgentId: originalParent.id,
      parentConfigurationSnapshot: snapshot,
    }),
    /read-only preset/,
  );
  agents.set(originalParent.id, {
    ...originalParent,
    configurationRevision: 2,
  });
  agents.set(initial.id, {
    ...agents.get(initial.id)!,
    parentGrants: { prompt: true, configure: false, stop: true },
  });
  await assert.rejects(
    service.configureAgent(initial.id, request, {
      parentAgentId: originalParent.id,
      parentConfigurationSnapshot: snapshot,
    }),
    /grant/,
  );
});

test("a newer permissive parent config cannot amplify an old tool snapshot and relative cwd is canonicalized", async () => {
  const { service, initial, agents } = fixture();
  const { agentConfigurationSchema } =
    await import("@nervekit/contracts/agents");
  const original = {
    ...initial,
    id: "agent_root",
    parentAgentId: undefined,
    rootAgentId: "agent_root",
    permissionLevel: "read_only" as const,
    permissionRuleSetId: "read_only",
    mode: "planning" as const,
  };
  const snapshot = {
    agentId: original.id,
    configurationRevision: 1,
    configuration: agentConfigurationSchema.parse(original),
    source: {
      runId: "run_original",
      attemptId: "exec_original",
      toolCallId: "tool_original",
    },
  };
  agents.set(original.id, {
    ...original,
    permissionLevel: "autonomous",
    permissionRuleSetId: "autonomous",
    mode: "coding",
    configurationRevision: 2,
  });
  await assert.rejects(
    service.configureAgent(
      initial.id,
      { permissionLevel: "autonomous" },
      { parentAgentId: original.id, parentConfigurationSnapshot: snapshot },
    ),
    /parent authority/,
  );
  const changed = await service.configureAgent(initial.id, {
    projectDir: "subdir",
    workspaceScope: { roots: ["."] },
  });
  assert.equal(changed.projectDir, "/workspace/subdir");
  assert.deepEqual(changed.workspaceScope.roots, ["/workspace/subdir"]);
  await assert.rejects(
    service.configureAgent(
      initial.id,
      {},
      {
        parentAgentId: original.id,
        parentConfigurationSnapshot: { ...snapshot, agentId: "agent_other" },
      },
    ),
    /accepted revision/,
  );
});

test("child creation inherits original model/mode/permissions/cwd/scope while immutable lineage and budgets stay live", async () => {
  const { agentConfigurationSchema } =
    await import("@nervekit/contracts/agents");
  const { defaultSettings } = await import("@nervekit/contracts/settings");
  const original = resolveAgentBlueprint(
    agentRecordSchema.parse({
      id: "agent_parent",
      rootAgentId: "agent_parent",
      conversationId: "conv_shared",
      projectId: "proj_test",
      projectDir: "/original",
      workspaceScope: { roots: ["/original"] },
      mode: "coding",
      permissionLevel: "autonomous",
      permissionRuleSetId: "autonomous",
      model: { provider: "original", modelId: "old-model" },
      thinkingLevel: "high",
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    }),
  );
  const snapshot = {
    agentId: original.id,
    configurationRevision: 1,
    configuration: agentConfigurationSchema.parse(original),
    source: {
      runId: "run_original",
      attemptId: "exec_original",
      toolCallId: "tool_original",
    },
  };
  const live = {
    ...original,
    configurationRevision: 2,
    projectDir: "/new",
    workspaceScope: { roots: ["/new"] },
    mode: "planning" as const,
    permissionLevel: "read_only" as const,
    permissionRuleSetId: "read_only",
    model: { provider: "new", modelId: "new-model" },
    thinkingLevel: "off" as const,
    budget: { ...original.budget, maxDepth: 2 },
  };
  const agents = new Map([[original.id, live]]);
  const writes: AgentRecord[] = [];
  const service = new AgentLifecycleService(
    { settings: defaultSettings } as Dependencies[0],
    { publish: async () => undefined } as unknown as Dependencies[1],
    { upsertAgent: () => undefined } as unknown as Dependencies[2],
    {
      agents,
      getConversation: () => ({
        id: "conv_shared",
        mode: "coding",
        permissionLevel: "read_only",
      }),
      getProject: () => ({ id: "proj_test", dir: "/new" }),
      maintenanceScopes: {
        assertConversation: () => undefined,
        assertProject: () => undefined,
      },
    } as unknown as Dependencies[3],
    {
      bindContextOwner: async (agent: AgentRecord) => ({
        ...agent,
        contextOwnerAgentId: agent.id,
      }),
      write: async (agent: AgentRecord) => {
        writes.push(agent);
      },
    } as unknown as Dependencies[4],
    {} as Dependencies[5],
    async () => undefined,
    async () => undefined,
    async () => undefined,
    async () => undefined,
  );
  const request = {
    conversationId: original.conversationId,
    projectId: original.projectId,
    parentAgentId: original.id,
  };
  const child = await service.createAgent(request, {
    parentConfigurationSnapshot: snapshot,
  });
  assert.deepEqual(child.model, original.model);
  assert.equal(child.thinkingLevel, "high");
  assert.equal(child.mode, "coding");
  assert.equal(child.permissionLevel, "autonomous");
  assert.equal(child.projectDir, "/original");
  assert.deepEqual(child.workspaceScope, original.workspaceScope);
  assert.equal(child.rootAgentId, original.id);
  assert.equal(
    child.budget.maxDepth,
    2,
    "snapshot cannot rewrite immutable/live identity budgets",
  );
  assert.deepEqual(writes, [child]);
  agents.set(original.id, { ...live, activationState: "paused" });
  await assert.rejects(
    service.createAgent(request, { parentConfigurationSnapshot: snapshot }),
    /paused parent/,
  );
  assert.equal(writes.length, 1);
});

test("live creation ignores legacy kind when resolving default or explicit configuration", async (t) => {
  const { defaultSettings } = await import("@nervekit/contracts/settings");
  for (const executionKind of [
    undefined,
    "root",
    "explore",
    "async_developer",
  ] as const) {
    for (const preset of [undefined, "explore", "developer"] as const) {
      await t.test(
        `${executionKind ?? "no kind"} with ${preset ?? "default"} configuration`,
        async () => {
          const agents = new Map<string, AgentRecord>();
          const writes: AgentRecord[] = [];
          const service = new AgentLifecycleService(
            { settings: defaultSettings } as Dependencies[0],
            { publish: async () => undefined } as unknown as Dependencies[1],
            { upsertAgent: () => undefined } as unknown as Dependencies[2],
            {
              agents,
              getConversation: () => ({
                id: "conv_shared",
                mode: "coding",
                permissionLevel: "supervised",
              }),
              getProject: () => ({ id: "proj_test", dir: "/workspace" }),
              maintenanceScopes: {
                assertConversation: () => undefined,
                assertProject: () => undefined,
              },
            } as unknown as Dependencies[3],
            {
              bindContextOwner: async (agent: AgentRecord) => ({
                ...agent,
                contextOwnerAgentId: null,
              }),
              write: async (agent: AgentRecord) => {
                writes.push(agent);
              },
            } as unknown as Dependencies[4],
            {} as Dependencies[5],
            async () => undefined,
            async () => undefined,
            async () => undefined,
            async () => undefined,
          );
          const orchestrationPolicy = preset
            ? {
                preset,
                parentCancellation:
                  preset === "explore"
                    ? ("attached" as const)
                    : ("independent" as const),
                completionReporting: "parent" as const,
              }
            : undefined;
          const agent = await service.createAgent({
            conversationId: "conv_shared",
            projectId: "proj_test",
            executionKind,
            orchestrationPolicy,
            permissionLevel: preset === "explore" ? "read_only" : "supervised",
            tools: ["read_file"],
            skills: [],
            instructions: "Explicit current configuration",
          });
          assert.equal(
            agent.executionKind,
            executionKind,
            "legacy field remains metadata",
          );
          assert.deepEqual(
            agent.orchestrationPolicy,
            orchestrationPolicy ?? {
              preset: "standard",
              parentCancellation: "independent",
              completionReporting: "none",
            },
          );
          assert.equal(agent.readOnlyCeiling, preset === "explore");
          assert.equal(
            agent.workspaceScope.readonly,
            preset === "explore" ? true : undefined,
          );
          assert.equal(
            agent.permissionLevel,
            preset === "explore" ? "read_only" : "supervised",
          );
          assert.deepEqual(agent.tools, ["read_file"]);
          assert.deepEqual(agent.skills, []);
          assert.equal(agent.instructions, "Explicit current configuration");
          assert.equal(agent.contextOwnerAgentId, null);
          assert.equal(agent.configurationRevision, 1);
          assert.deepEqual(writes, [agent]);
        },
      );
    }
  }
});
