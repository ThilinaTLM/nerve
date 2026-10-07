import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  agentRecordSchema,
  resolveAgentBlueprint,
  type AgentRecord,
  type AgentConfigurationAcceptance,
} from "@nervekit/contracts/agents";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { AgentRepository } from "../../../src/domains/agents/agent.repository.js";
import { AgentLifecycleService } from "../../../src/domains/agents/agent-lifecycle.service.js";
import { assertLiveParentDelegation } from "../../../src/domains/agents/agent-authority.js";

type Dependencies = ConstructorParameters<typeof AgentLifecycleService>;
const now = "2026-10-07T00:00:00.000Z";
function record(id = "agent_child"): AgentRecord {
  return resolveAgentBlueprint(
    agentRecordSchema.parse({
      id,
      conversationId: "conv_shared",
      projectId: "proj_test",
      rootAgentId: "agent_parent",
      parentAgentId: id === "agent_child" ? "agent_parent" : undefined,
      contextOwnerAgentId: id === "agent_child" ? id : null,
      mode: "coding",
      permissionLevel: "supervised",
      permissionRuleSetId: "supervised",
      projectDir: "/workspace",
      workspaceScope: { roots: ["/workspace"] },
      createdAt: now,
      updatedAt: now,
    }),
  );
}
function service(
  store: CanonicalStore,
  repository: AgentRepository,
  agents: Map<string, AgentRecord>,
  published: string[] = [],
) {
  return new AgentLifecycleService(
    { canonicalStore: store } as Dependencies[0],
    {
      publish: async (type: string) => {
        published.push(type);
      },
    } as unknown as Dependencies[1],
    { upsertAgent: () => undefined } as unknown as Dependencies[2],
    {
      agents,
      getAgent: (id: string) => {
        const actor = agents.get(id);
        assert.ok(actor);
        return actor;
      },
    } as unknown as Dependencies[3],
    repository,
    {} as Dependencies[5],
    async () => undefined,
    async () => undefined,
    async () => undefined,
    async () => undefined,
  );
}

test("configuration receipt commits atomically with revision; injected commit failure preserves old accepted state after restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-receipt-atomic-"));
  const path = join(home, "nerve.sqlite");
  let store = new CanonicalStore(path, { readerCount: 0 });
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const initial = record();
  const repository = new AgentRepository({
    canonicalStore: store,
  } as Dependencies[0]);
  await repository.write(initial);
  const agents = new Map([[initial.id, initial]]);
  const published: string[] = [];
  const lifecycle = service(store, repository, agents, published);
  const write = store.writeDocument.bind(store);
  store.writeDocument = async (command) => {
    if (
      command.namespace === "agent" &&
      (command.data as AgentRecord).configurationAcceptances?.length
    )
      throw new Error("injected receipt/config commit failure");
    return write(command);
  };
  await assert.rejects(
    lifecycle.configureAgent(
      initial.id,
      { instructions: "Must roll back" },
      { actor: { kind: "user", userId: "authenticated" } },
    ),
    /commit failure/,
  );
  assert.deepEqual(lifecycle.getAgent(initial.id), initial);
  assert.deepEqual(published, []);
  await store.close();
  store = new CanonicalStore(path, { readerCount: 0 });
  await store.initialize();
  const restored = new AgentRepository({
    canonicalStore: store,
  } as Dependencies[0]);
  assert.deepEqual((await restored.loadAll())[0], initial);
  assert.deepEqual(await restored.listConfigurationAcceptances(), []);
});

test("initial notice-intent registration failure and copied crash restart recover EXACT old user revision, not later parent/self/system edits", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-receipt-recovery-"));
  const path = join(home, "nerve.sqlite");
  const copiedPath = join(home, "copied.sqlite");
  let store = new CanonicalStore(path, { readerCount: 0 });
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const repository = new AgentRepository({
    canonicalStore: store,
  } as Dependencies[0]);
  const child = record();
  const parent = { ...record("agent_parent"), rootAgentId: "agent_parent" };
  await repository.write(child);
  await repository.write(parent);
  const lifecycle = service(
    store,
    repository,
    new Map([
      [child.id, child],
      [parent.id, parent],
    ]),
  );
  let failedReceipt: AgentConfigurationAcceptance | undefined;
  await lifecycle.configureAgent(
    child.id,
    { instructions: "User revision" },
    {
      actor: { kind: "user", userId: "authenticated" },
      onConfigurationAccepted: async (receipt) => {
        failedReceipt = receipt;
        throw new Error(
          "initial obligation registration failed before any durable intent",
        );
      },
    },
  );
  assert.equal(failedReceipt?.configurationRevision, 2);
  assert.equal(lifecycle.getAgent(child.id).instructions, "User revision");
  await assert.rejects(
    lifecycle.configureAgent(
      child.id,
      { instructions: "Wrong actor" },
      {
        actor: { kind: "parent", agentId: "agent_other" },
        parentAgentId: parent.id,
      },
    ),
    /trusted authorization context/,
  );
  await assert.rejects(
    lifecycle.configureAgent(
      child.id,
      { instructions: "Wrong self" },
      { actor: { kind: "self", agentId: parent.id } },
    ),
    /trusted authorization context/,
  );
  await assert.rejects(
    lifecycle.configureAgent(
      child.id,
      { instructions: "User cannot masquerade as parent operation" },
      {
        actor: { kind: "user", userId: "authenticated" },
        parentAgentId: parent.id,
      },
    ),
    /trusted authorization context/,
  );
  await lifecycle.configureAgent(
    child.id,
    { instructions: "Later parent revision" },
    { parentAgentId: parent.id, actor: { kind: "parent", agentId: parent.id } },
  );
  await lifecycle.configureAgent(
    child.id,
    { instructions: "Later self revision" },
    { actor: { kind: "self", agentId: child.id } },
  );
  const spoofedRequest = {
    instructions: "Unattributed internal revision",
    actor: { kind: "user", userId: "spoofed" },
    configurationAcceptances: [failedReceipt],
  };
  await lifecycle.configureAgent(child.id, spoofedRequest);
  await lifecycle.configureAgent(
    child.id,
    { instructions: "Explicit system revision" },
    {
      actor: {
        kind: "system",
        producer: "maintenance",
        correlationId: "repair_1",
      },
    },
  );
  await lifecycle.setEffectiveConfigurationRevision(child.id, 4);
  await lifecycle.setActivationState(child.id, "paused");
  await store.close();
  await copyFile(path, copiedPath);
  store = new CanonicalStore(copiedPath, { readerCount: 0 });
  await store.initialize();
  const reopened = new AgentRepository({
    canonicalStore: store,
  } as Dependencies[0]);
  const restored = (await reopened.loadAll()).find(
    (agent) => agent.id === child.id,
  );
  assert.equal(restored?.configurationRevision, 6);
  const receipts = await reopened.listConfigurationAcceptances(child.id);
  assert.deepEqual(
    receipts.map((receipt) => [
      receipt.configurationRevision,
      receipt.actor.kind,
    ]),
    [
      [2, "user"],
      [3, "parent"],
      [4, "self"],
      [5, "system"],
      [6, "system"],
    ],
  );
  const user = receipts.filter((receipt) => receipt.actor.kind === "user");
  assert.deepEqual(user, [failedReceipt]);
  assert.equal(user[0]?.parentAgentId, parent.id);
  assert.equal(user[0]?.conversationId, child.conversationId);
  assert.equal(
    receipts[3]?.actor.kind === "system" && receipts[3].actor.producer,
    "agent_lifecycle",
  );
  // This is the recovery consumer contract: repeat scans dedup exact action identity.
  const recovered = new Set<string>();
  for (let retry = 0; retry < 2; retry++)
    for (const receipt of await reopened.listConfigurationAcceptances())
      if (receipt.actor.kind === "user")
        recovered.add(
          `configuration:${receipt.agentId}:${receipt.configurationRevision}`,
        );
  assert.deepEqual([...recovered], ["configuration:agent_child:2"]);
  assert.ok(restored);
  await assert.rejects(
    reopened.write({
      ...restored,
      configurationAcceptances: receipts.slice(1),
    }),
    /immutable/,
  );
  await assert.rejects(
    reopened.write({
      ...restored,
      configurationAcceptances: receipts.map((receipt, index) =>
        index === 0
          ? { ...receipt, actor: { kind: "system", producer: "fake" } }
          : receipt,
      ),
    }),
    /immutable/,
  );
});

test("only a validated administrative admission can bypass paused parent; immutable readonly floors remain live", () => {
  const parent = {
    ...record("agent_parent"),
    activationState: "paused" as const,
  };
  const child = record();
  assert.throws(
    () => assertLiveParentDelegation(parent, child),
    /paused parent/,
  );
  assert.doesNotThrow(() =>
    assertLiveParentDelegation(parent, child, { allowPausedParent: true }),
  );
  assert.throws(
    () =>
      assertLiveParentDelegation({ ...parent, readOnlyCeiling: true }, child, {
        allowPausedParent: true,
      }),
    /read-only preset ceiling/,
  );
  assert.doesNotThrow(() =>
    assertLiveParentDelegation(
      { ...parent, readOnlyCeiling: true },
      {
        ...child,
        permissionLevel: "read_only",
        permissionRuleSetId: "read_only",
        workspaceScope: { roots: ["/workspace"], readonly: true },
      },
      { allowPausedParent: true },
    ),
  );
});
