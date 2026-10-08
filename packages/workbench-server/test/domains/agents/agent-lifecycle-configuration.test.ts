import assert from "node:assert/strict";
import test from "node:test";
import {
  agentRecordSchema,
  resolveAgentBlueprint,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import {
  AgentInputService,
  type AgentInputQueueState,
} from "../../../src/domains/runs/runtime/agent-inputs.js";
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
  let committed: AgentRecord | undefined;
  const service = new AgentLifecycleService(
    {
      canonicalStore: {
        readDocument: async (
          _namespace: string,
          _scope: string,
          id: string,
        ) => ({ data: committed ?? agents.get(id) }),
      },
    } as unknown as Dependencies[0],
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
        if (committed) committed = agent;
      },
    } as unknown as Dependencies[4],
    {} as Dependencies[5],
    async () => undefined,
    async () => undefined,
    async () => "run_active",
  );
  return {
    service,
    agents,
    writes,
    published,
    initial,
    setCommitted: (agent: AgentRecord) => {
      committed = agent;
    },
    committed: () => committed,
    fail: () => {
      failWrite = true;
    },
  };
}

test("busy children accept complete configuration and serialize accepted revisions without changing an in-flight harness", async () => {
  const { service, initial, writes } = fixture();
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
            ...{ executionKind },
            orchestrationPolicy,
            permissionLevel: preset === "explore" ? "read_only" : "supervised",
            tools: ["read_file"],
            skills: [],
            instructions: "Explicit current configuration",
          });
          assert.equal(
            agent.executionKind,
            undefined,
            "obsolete create metadata is not persisted",
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

test("prepared revision claim orders configuration before and after dispatch without recursive queue deadlock", async () => {
  const { service, initial, writes } = fixture();
  const replacement = await service.configureAgent(initial.id, {
    instructions: "new",
  });
  let commits = 0;
  assert.deepEqual(
    await service.claimPreparedTurn(
      initial,
      async () => {
        commits++;
      },
      async () => undefined,
    ),
    { kind: "refresh" },
  );
  assert.equal(commits, 0);
  assert.equal(writes.length, 1);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claim = service.claimPreparedTurn(
    replacement,
    async () => {
      commits++;
      entered();
      await gate;
    },
    async () => undefined,
  );
  await ready;
  const next = service.configureAgent(initial.id, { instructions: "later" });
  release();
  assert.deepEqual(await claim, { kind: "ready" });
  const latest = await next;
  assert.equal(commits, 1);
  assert.equal(latest.configurationRevision, 3);
  assert.equal(latest.effectiveConfigurationRevision, 2);
  assert.equal(latest.instructions, "later");
});

test("effective write failure retains delivered context as undispatched after snapshot recording", async () => {
  const { service, initial, fail, writes } = fixture();
  const documents = new Map<string, AgentInputQueueState>();
  let id = 0;
  const queue = new AgentInputService(
    {
      load: async (key) => structuredClone(documents.get(key)),
      save: async (key, value) => {
        documents.set(key, structuredClone(value));
      },
    },
    { next: () => String(++id) },
    { now: () => new Date() },
  );
  await queue.accept(
    initial.id,
    initial.conversationId,
    {
      text: "durable input",
      role: "user",
      origin: { kind: "user", userId: "user" },
      idempotencyKey: "failure-input",
      eligibility: { kind: "next_turn" },
      activation: "queue_only",
    },
    async () => undefined,
  );
  await queue.prepare(
    {
      agentId: initial.id,
      conversationId: initial.conversationId,
      runId: "run_test",
      attemptId: "exec_test",
      turnId: "prepared_test",
    },
    async () => undefined,
    async () => false,
  );
  assert.equal(await queue.hasContextPending(initial.id), true);
  let snapshots = 0,
    dispatchClears = 0,
    providerInvocations = 0;
  fail();
  await assert.rejects(
    (async () => {
      await service.claimPreparedTurn(
        initial,
        async () => {
          snapshots++;
        },
        async () => {
          dispatchClears++;
          await queue.recordProviderDispatch(initial.id);
        },
      );
      providerInvocations++;
    })(),
    /disk failure/,
  );
  assert.equal(snapshots, 1);
  assert.equal(dispatchClears, 0);
  assert.equal(providerInvocations, 0);
  assert.equal(writes.length, 0);
  assert.equal(service.getAgent(initial.id).effectiveConfigurationRevision, 0);
  assert.equal(await queue.hasContextPending(initial.id), true);
});

test("claim and effective persistence use canonical configuration when cache is stale", async () => {
  const { service, initial, setCommitted, committed, writes } = fixture();
  const canonical = {
    ...initial,
    configurationRevision: 3,
    instructions: "canonical latest",
    tools: ["read"],
    model: { provider: "canonical-provider", modelId: "canonical-model" },
  };
  setCommitted(canonical);
  let snapshots = 0;
  assert.deepEqual(
    await service.claimPreparedTurn(
      initial,
      async () => {
        snapshots++;
      },
      async () => undefined,
    ),
    { kind: "refresh" },
  );
  assert.equal(snapshots, 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(
    await service.claimPreparedTurn(
      canonical,
      async () => {
        snapshots++;
      },
      async () => {
        assert.equal(committed()?.effectiveConfigurationRevision, 3);
      },
    ),
    { kind: "ready" },
  );
  assert.equal(snapshots, 1);
  assert.equal(writes[0]?.instructions, "canonical latest");
  assert.deepEqual(writes[0]?.model, canonical.model);
  assert.deepEqual(writes[0]?.tools, canonical.tools);
  assert.equal(service.getAgent(initial.id).configurationRevision, 3);
  assert.equal(service.getAgent(initial.id).effectiveConfigurationRevision, 3);
  // The public setter also reads canonical state rather than overwriting it with stale cache.
  setCommitted({
    ...canonical,
    configurationRevision: 4,
    instructions: "even newer",
    effectiveConfigurationRevision: 3,
  });
  const adopted = await service.setEffectiveConfigurationRevision(
    initial.id,
    3,
  );
  assert.equal(adopted.configurationRevision, 4);
  assert.equal(adopted.instructions, "even newer");
});

test("canonical scope mismatch rejects a claim even when cached scope matches", async () => {
  const { service, initial, setCommitted } = fixture();
  setCommitted({ ...initial, conversationId: "conv_corrupt" });
  let effects = 0;
  await assert.rejects(
    service.claimPreparedTurn(
      initial,
      async () => {
        effects++;
      },
      async () => {
        effects++;
      },
    ),
    /scope is corrupt/,
  );
  assert.equal(effects, 0);
});
