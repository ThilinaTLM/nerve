import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  agentRecordSchema,
  resolveAgentBlueprint,
} from "@nervekit/contracts/agents";
import type { InitializedStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { AgentRepository } from "../../../src/domains/agents/agent.repository.js";
import { assertAgentConfigurationAuthority } from "../../../src/domains/agents/agent-authority.js";

const now = "2026-10-06T00:00:00.000Z";
function record() {
  return agentRecordSchema.parse({
    id: "agent_child",
    conversationId: "conv_shared",
    projectId: "proj_test",
    rootAgentId: "agent_root",
    parentAgentId: "agent_root",
    projectDir: "/workspace/subdir",
    mode: "coding",
    permissionLevel: "read_only",
    permissionRuleSetId: "read_only",
    workspaceScope: { roots: ["/workspace/subdir"], readonly: true },
    createdAt: now,
    updatedAt: now,
  });
}

test("agent repository migrates documents in an isolated SQLite home and reconstructs configuration after restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-agent-migration-"));
  const path = join(home, "canonical.sqlite");
  let store = new CanonicalStore(path, { readerCount: 0 });
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const repository = new AgentRepository({
    canonicalStore: store,
  } as InitializedStorage);
  await store.writeDocument({
    namespace: "agent",
    scopeId: "global",
    documentId: "agent_child",
    data: { ...record(), executionKind: "explore" },
    expectedRevision: 0,
    now,
  });
  const [migrated] = await repository.loadAll();
  assert.equal(migrated?.id, "agent_child");
  assert.equal(migrated?.conversationId, "conv_shared");
  assert.equal(migrated?.readOnlyCeiling, true);
  assert.equal(migrated?.configurationRevision, 1);
  const persisted = await store.readDocument("agent", "global", "agent_child");
  assert.equal(persisted?.revision, 2);
  assert.deepEqual(persisted?.data, migrated);
  assert.deepEqual(await repository.loadAll(), [migrated]);
  assert.equal(
    (await store.readDocument("agent", "global", "agent_child"))?.revision,
    2,
  );
  assert.ok(migrated);
  await repository.write({
    ...migrated,
    tools: ["read_file"],
    skills: ["review"],
    instructions: "Inspect safely",
    configurationRevision: 2,
    activationState: "paused",
  });
  await store.close();
  store = new CanonicalStore(path, { readerCount: 0 });
  await store.initialize();
  const reopened = new AgentRepository({
    canonicalStore: store,
  } as InitializedStorage);
  const [restored] = await reopened.loadAll();
  assert.equal(restored?.activationState, "paused");
  assert.equal(restored?.configurationRevision, 2);
  assert.deepEqual(restored?.tools, ["read_file"]);
  assert.deepEqual(restored?.skills, ["review"]);
  assert.equal(restored?.instructions, "Inspect safely");
});

test("users can configure children but neither user nor parent can elevate read-only presets", () => {
  const child = resolveAgentBlueprint({
    ...record(),
    orchestrationPolicy: {
      preset: "explore",
      parentCancellation: "attached",
      completionReporting: "parent",
    },
  });
  assert.doesNotThrow(() =>
    assertAgentConfigurationAuthority(child, {
      ...child,
      instructions: "New direction",
    }),
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(child, {
        ...child,
        permissionLevel: "autonomous",
      }),
    /read-only preset/,
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(child, {
        ...child,
        permissionRuleSetId: "autonomous",
      }),
    /read-only preset/,
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(child, {
        ...child,
        workspaceScope: { ...child.workspaceScope, readonly: false },
      }),
    /read-only preset/,
  );
});

test("delegated configuration is bounded by relationship, grants, permission and workspace", () => {
  const child = resolveAgentBlueprint(record());
  const parent = resolveAgentBlueprint({
    ...record(),
    id: "agent_root",
    parentAgentId: undefined,
    projectDir: "/workspace",
    workspaceScope: { roots: ["/workspace"] },
  });
  assert.doesNotThrow(() =>
    assertAgentConfigurationAuthority(child, child, parent),
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(child, child, {
        ...parent,
        id: "agent_other",
      }),
    /own child/,
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(
        {
          ...child,
          parentGrants: { prompt: true, configure: false, stop: true },
        },
        child,
        parent,
      ),
    /grant/,
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(
        child,
        { ...child, permissionLevel: "autonomous" },
        parent,
      ),
    /parent authority/,
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(
        child,
        { ...child, projectDir: "/workspace-escape" },
        parent,
      ),
    /parent workspace/,
  );
  assert.throws(
    () =>
      assertAgentConfigurationAuthority(
        child,
        { ...child, workspaceScope: { roots: ["/workspace/../outside"] } },
        parent,
      ),
    /parent workspace/,
  );
});

test("context migration preserves the historical lead tree and isolates additional roots, children and orphan children", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-context-migration-"));
  const sqlitePath = join(home, "canonical.sqlite");
  const store = new CanonicalStore(sqlitePath, { readerCount: 0 });
  await store.initialize();
  const { ConversationJournalRepository } =
    await import("../../../src/domains/conversations/conversation-journal.repository.js");
  const journal = new ConversationJournalRepository({
    paths: { home, sqlitePath },
    canonicalStore: store,
  });
  t.after(async () => {
    await journal.close();
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const repository = new AgentRepository({
    canonicalStore: store,
  } as InitializedStorage);
  const root = {
    ...record(),
    id: "agent_original",
    rootAgentId: "agent_original",
    parentAgentId: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const sibling = {
    ...root,
    id: "agent_second",
    rootAgentId: "agent_second",
    createdAt: now,
  };
  const child = { ...record(), rootAgentId: root.id, parentAgentId: root.id };
  const orphan = {
    ...child,
    id: "agent_orphan",
    parentAgentId: undefined,
    executionKind: "explore" as const,
  };
  // Insert reversed order: SQL enumeration is not lead identity authority.
  for (const agent of [sibling, orphan, child, root])
    await store.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: agent.id,
      data: agent,
      expectedRevision: 0,
      now,
    });
  await journal.commit("conv_shared", {
    kind: "conversation.created",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_shared",
        conversation: {
          id: "conv_shared",
          projectId: "proj_test",
          title: "Legacy",
          mode: "coding",
          permissionLevel: "read_only",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        kind: "model_context.entry_appended",
        conversationId: "conv_shared",
        entry: {
          type: "message",
          id: "entry_historical",
          parentId: null,
          timestamp: now,
          message: {
            role: "user",
            content: "Historical lead only",
            timestamp: Date.parse(now),
          },
        },
      },
      {
        kind: "model_context.leaf_changed",
        conversationId: "conv_shared",
        entryId: "entry_historical",
      },
      {
        kind: "model_context.entry_appended",
        conversationId: "conv_shared",
        ownerAgentId: child.id,
        entry: {
          type: "message",
          id: "entry_old_child",
          parentId: null,
          timestamp: now,
          message: {
            role: "user",
            content: "Historical child only",
            timestamp: Date.parse(now),
          },
        },
      },
      {
        kind: "model_context.leaf_changed",
        conversationId: "conv_shared",
        ownerAgentId: child.id,
        entryId: "entry_old_child",
      },
    ],
  });
  const agents = await repository.loadAll();
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  assert.equal(byId.get(root.id)?.contextOwnerAgentId, null);
  for (const id of [sibling.id, child.id, orphan.id])
    assert.equal(byId.get(id)?.contextOwnerAgentId, id);
  let state = await journal.load("conv_shared");
  assert.deepEqual(
    state.modelEntries.map((entry) => entry.id),
    ["entry_historical"],
  );
  assert.deepEqual(
    state.agentModelEntries.get(child.id)?.map((entry) => entry.id),
    ["entry_old_child"],
  );
  for (const id of [sibling.id, orphan.id]) {
    const ownerAgentId = byId.get(id)?.contextOwnerAgentId ?? undefined;
    assert.equal(ownerAgentId, id);
    await journal.commit("conv_shared", {
      kind: "conversation.updated",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: "conv_shared",
          ownerAgentId,
          entry: {
            type: "message",
            id: `entry_${id}`,
            parentId: null,
            timestamp: now,
            message: {
              role: "user",
              content: `Private ${id}`,
              timestamp: Date.parse(now),
            },
          },
        },
        {
          kind: "model_context.leaf_changed",
          conversationId: "conv_shared",
          ownerAgentId,
          entryId: `entry_${id}`,
        },
      ],
    });
  }
  state = await journal.load("conv_shared");
  assert.deepEqual(
    state.modelEntries.map((entry) => entry.id),
    ["entry_historical"],
  );
  assert.deepEqual(
    state.agentModelEntries.get(child.id)?.map((entry) => entry.id),
    ["entry_old_child"],
  );
  assert.deepEqual(
    state.agentModelEntries.get(sibling.id)?.map((entry) => entry.id),
    ["entry_historical", `entry_${sibling.id}`],
  );
  assert.deepEqual(
    state.agentModelEntries.get(orphan.id)?.map((entry) => entry.id),
    [`entry_${orphan.id}`],
  );
  await assert.rejects(
    repository.write({ ...byId.get(sibling.id)!, contextOwnerAgentId: null }),
    /immutable/,
  );
  await repository.remove(root.id);
  const newRoot = await repository.bindContextOwner(
    resolveAgentBlueprint({
      ...root,
      id: "agent_new",
      rootAgentId: "agent_new",
      createdAt: now,
    }),
  );
  assert.equal(
    newRoot.contextOwnerAgentId,
    "agent_new",
    "deleted lead's tree must never be reassigned",
  );
  await repository.write(newRoot);
  assert.equal(
    (await repository.loadAll()).find((agent) => agent.id === newRoot.id)
      ?.contextOwnerAgentId,
    newRoot.id,
  );
});

test("new roots receive a persisted immutable context binding before sharing a legacy conversation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-context-create-"));
  const store = new CanonicalStore(join(home, "canonical.sqlite"), {
    readerCount: 0,
  });
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const repository = new AgentRepository({
    canonicalStore: store,
  } as InitializedStorage);
  const makeRoot = (id: string) =>
    resolveAgentBlueprint({
      ...record(),
      id,
      rootAgentId: id,
      parentAgentId: undefined,
    });
  const first = await repository.bindContextOwner(makeRoot("agent_first"));
  await repository.write(first);
  const second = await repository.bindContextOwner(makeRoot("agent_second"));
  await repository.write(second);
  assert.equal(first.contextOwnerAgentId, null);
  assert.equal(second.contextOwnerAgentId, second.id);
  await repository.remove(first.id);
  const third = await repository.bindContextOwner(makeRoot("agent_third"));
  assert.equal(third.contextOwnerAgentId, third.id);
});

test("lifecycle publishes persisted isolated ownership for a second independent root", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-root-lifecycle-"));
  const store = new CanonicalStore(join(home, "canonical.sqlite"), {
    readerCount: 0,
  });
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const { AgentLifecycleService } =
    await import("../../../src/domains/agents/agent-lifecycle.service.js");
  const { defaultSettings } = await import("@nervekit/contracts/settings");
  type Dependencies = ConstructorParameters<typeof AgentLifecycleService>;
  const storage = {
    canonicalStore: store,
    settings: defaultSettings,
  } as InitializedStorage;
  const repository = new AgentRepository(storage);
  const agents = new Map<string, ReturnType<typeof record>>();
  const conversation = {
    id: "conv_shared",
    projectId: "proj_test",
    mode: "coding",
    permissionLevel: "read_only",
  };
  const publishedOwners: (string | null | undefined)[] = [];
  const service = new AgentLifecycleService(
    storage,
    {
      publish: async (
        _type: string,
        data: { agent: ReturnType<typeof record> },
      ) => {
        const document = await store.readDocument<ReturnType<typeof record>>(
          "agent",
          "global",
          data.agent.id,
        );
        assert.equal(
          document?.data.contextOwnerAgentId,
          data.agent.contextOwnerAgentId,
        );
        publishedOwners.push(data.agent.contextOwnerAgentId);
      },
    } as unknown as Dependencies[1],
    { upsertAgent: () => undefined } as unknown as Dependencies[2],
    {
      agents,
      getConversation: () => conversation,
      getProject: () => ({ id: "proj_test", dir: home }),
      maintenanceScopes: {
        assertConversation: () => undefined,
        assertProject: () => undefined,
      },
    } as unknown as Dependencies[3],
    repository,
    {} as Dependencies[5],
    async () => undefined,
    async () => undefined,
    async () => undefined,
  );
  const request = {
    conversationId: "conv_shared",
    projectId: "proj_test",
    permissionLevel: "read_only" as const,
  };
  const lead = await service.createAgent(request, {
    id: "agent_lifecycle_lead",
  });
  const second = await service.createAgent(request, {
    id: "agent_lifecycle_second",
  });
  assert.equal(lead.contextOwnerAgentId, null);
  assert.equal(second.contextOwnerAgentId, second.id);
  assert.deepEqual(publishedOwners, [null, second.id]);
  assert.equal(agents.get(second.id)?.contextOwnerAgentId, second.id);
});

test("copied old SQLite roots retain the complete shared tree across partial-copy crash, restart and independent writes", async (t) => {
  const sourceHome = await mkdtemp(
    join(tmpdir(), "nerve-402-old-root-source-"),
  );
  const copiedHome = await mkdtemp(join(tmpdir(), "nerve-402-old-root-copy-"));
  const sourcePath = join(sourceHome, "canonical.sqlite");
  const copiedPath = join(copiedHome, "canonical.sqlite");
  const { ConversationJournalRepository } =
    await import("../../../src/domains/conversations/conversation-journal.repository.js");
  const sourceStore = new CanonicalStore(sourcePath, { readerCount: 0 });
  await sourceStore.initialize();
  const sourceJournal = new ConversationJournalRepository({
    paths: { home: sourceHome, sqlitePath: sourcePath },
    canonicalStore: sourceStore,
  });
  const lead = {
    ...record(),
    id: "agent_old_lead",
    parentAgentId: undefined,
    rootAgentId: "agent_old_lead",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const secondary = {
    ...lead,
    id: "agent_old_second",
    rootAgentId: "agent_old_second",
    createdAt: now,
  };
  for (const agent of [secondary, lead])
    await sourceStore.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: agent.id,
      data: agent,
      expectedRevision: 0,
      now,
    });
  const entries = Array.from({ length: 300 }, (_, index) => ({
    type: "message" as const,
    id: `entry_old_${index}`,
    parentId: index ? `entry_old_${index - 1}` : null,
    timestamp: now,
    message: {
      role: "user" as const,
      content: `Old message ${index}`,
      timestamp: Date.parse(now),
    },
  }));
  entries.push({
    type: "message",
    id: "entry_detached",
    parentId: "entry_old_10",
    timestamp: now,
    message: {
      role: "user",
      content: "Detached branch must survive",
      timestamp: Date.parse(now),
    },
  });
  await sourceJournal.commit("conv_shared", {
    kind: "conversation.created",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_shared",
        conversation: {
          id: "conv_shared",
          projectId: "proj_test",
          title: "Actual old shared roots",
          mode: "coding",
          permissionLevel: "read_only",
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  });
  for (let offset = 0; offset < entries.length; offset += 256)
    await sourceJournal.commit("conv_shared", {
      kind: "legacy.model_entries",
      events: entries.slice(offset, offset + 256).map((entry) => ({
        kind: "model_context.entry_appended",
        conversationId: "conv_shared",
        entry,
      })),
    });
  // The active checkpoint anchors an older path; copying only latest output loses both tails and detached branches.
  const activeCheckpointEntryId = "entry_old_150";
  await sourceJournal.commit("conv_shared", {
    kind: "legacy.active_checkpoint",
    events: [
      {
        kind: "model_context.leaf_changed",
        conversationId: "conv_shared",
        entryId: activeCheckpointEntryId,
      },
    ],
  });
  const original = await sourceJournal.load("conv_shared");
  assert.equal(
    original.agentModelEntries.size,
    0,
    "real old layout has NO preseeded agent partitions",
  );
  await sourceJournal.close();
  await sourceStore.close();
  await copyFile(sourcePath, copiedPath);
  let store = new CanonicalStore(copiedPath, { readerCount: 0 });
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(sourceHome, { recursive: true, force: true });
    await rm(copiedHome, { recursive: true, force: true });
  });
  const storage = () =>
    ({
      paths: { home: copiedHome, sqlitePath: copiedPath },
      canonicalStore: store,
    }) as InitializedStorage;
  const persistCommit = store.persistConversationCommit.bind(store);
  store.persistConversationCommit = async (delta) => {
    if (
      delta.commit.idempotencyKey ===
      `agent-context-prefix-copy:${secondary.id}:entries:256`
    )
      throw new Error("crash after first copied batch");
    await persistCommit(delta);
  };
  await assert.rejects(
    new AgentRepository(storage()).loadAll(),
    /crash after first copied batch/,
  );
  assert.equal(
    (
      await store.readDocument<ReturnType<typeof record>>(
        "agent",
        "global",
        secondary.id,
      )
    )?.data.contextOwnerAgentId,
    undefined,
    "binding cannot become visible before the complete tree copy",
  );
  await store.close();
  store = new CanonicalStore(copiedPath, { readerCount: 0 });
  await store.initialize();
  let journal = new ConversationJournalRepository(storage());
  const partial = await journal.load("conv_shared");
  assert.equal(partial.agentModelEntries.get(secondary.id)?.length, 256);
  // A changing lead after the crash must not alter the already-fixed migration source.
  await journal.commit("conv_shared", {
    kind: "lead.later_write",
    events: [
      {
        kind: "model_context.entry_appended",
        conversationId: "conv_shared",
        entry: {
          ...entries[0]!,
          id: "entry_lead_after_snapshot",
          parentId: activeCheckpointEntryId,
        },
      },
      {
        kind: "model_context.leaf_changed",
        conversationId: "conv_shared",
        entryId: "entry_lead_after_snapshot",
      },
    ],
  });
  let repository = new AgentRepository(storage());
  const writeDocument = store.writeDocument.bind(store);
  store.writeDocument = async (input) => {
    if (input.namespace === "agent" && input.documentId === secondary.id)
      throw new Error("crash after copy before binding");
    return writeDocument(input);
  };
  await assert.rejects(repository.loadAll(), /crash after copy before binding/);
  const completedCopyRevision = (await journal.load("conv_shared")).revision;
  assert.equal(
    (
      await store.readDocument<ReturnType<typeof record>>(
        "agent",
        "global",
        secondary.id,
      )
    )?.data.contextOwnerAgentId,
    undefined,
  );
  await journal.close();
  await store.close();
  store = new CanonicalStore(copiedPath, { readerCount: 0 });
  await store.initialize();
  journal = new ConversationJournalRepository(storage());
  repository = new AgentRepository(storage());
  const migrated = await repository.loadAll();
  assert.equal(
    (await journal.load("conv_shared")).revision,
    completedCopyRevision,
    "completed copy receipt survives crash before binding without duplicate copy",
  );
  assert.equal(
    migrated.find((agent) => agent.id === lead.id)?.contextOwnerAgentId,
    null,
  );
  assert.equal(
    migrated.find((agent) => agent.id === secondary.id)?.contextOwnerAgentId,
    secondary.id,
  );
  let state = await journal.load("conv_shared");
  assert.deepEqual(
    state.agentModelEntries.get(secondary.id),
    original.modelEntries,
  );
  assert.equal(
    state.agentModelLeafIds.get(secondary.id),
    activeCheckpointEntryId,
  );
  assert.deepEqual(
    state.agentModelTrees
      .get(secondary.id)
      ?.getPathToRoot(activeCheckpointEntryId),
    original.modelTree.getPathToRoot(activeCheckpointEntryId),
  );
  assert.ok(state.agentModelEntryById.get(secondary.id)?.has("entry_detached"));
  assert.ok(
    state.agentModelEntryById.get(secondary.id)?.has(activeCheckpointEntryId),
  );
  assert.equal(
    state.modelLeafId,
    "entry_lead_after_snapshot",
    "designated lead tree is untouched by copy",
  );
  const copiedRevision = state.revision;
  await repository.loadAll();
  assert.equal(
    (await journal.load("conv_shared")).revision,
    copiedRevision,
    "restart/load cannot duplicate prefix commits",
  );
  await Promise.all([
    journal.commit("conv_shared", {
      kind: "lead.new_write",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: "conv_shared",
          entry: {
            ...entries[0]!,
            id: "entry_lead_new",
            parentId: "entry_lead_after_snapshot",
          },
        },
      ],
    }),
    journal.commit("conv_shared", {
      kind: "secondary.new_write",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: "conv_shared",
          ownerAgentId: secondary.id,
          entry: {
            ...entries[0]!,
            id: "entry_secondary_new",
            parentId: activeCheckpointEntryId,
          },
        },
      ],
    }),
  ]);
  state = await journal.load("conv_shared");
  assert.equal(state.modelLeafId, "entry_lead_new");
  assert.equal(
    state.agentModelLeafIds.get(secondary.id),
    "entry_secondary_new",
  );
  assert.equal(state.modelEntryById.has("entry_secondary_new"), false);
  assert.equal(
    state.agentModelEntryById.get(secondary.id)?.has("entry_lead_new"),
    false,
  );
  const fresh = await repository.bindContextOwner(
    resolveAgentBlueprint({
      ...lead,
      id: "agent_fresh",
      rootAgentId: "agent_fresh",
      createdAt: now,
    }),
  );
  await repository.write(fresh);
  assert.equal(fresh.contextOwnerAgentId, fresh.id);
  assert.equal(
    (await journal.load("conv_shared")).agentModelEntries.has(fresh.id),
    false,
    "new additional root remains fresh, not a migrated shared prefix",
  );
  await journal.close();
});
