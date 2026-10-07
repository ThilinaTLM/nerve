import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import {
  ConversationBranchConflictError,
  ConversationJournalRepository,
} from "../../../src/domains/conversations/conversation-journal.repository.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { agentRecordSchema } from "@nervekit/contracts/agents";
import { AgentRepository } from "../../../src/domains/agents/agent.repository.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { EntryRepository } from "../../../src/domains/conversations/entry.repository.js";

const conversationId = "conv_journal_child_guard";
const now = "2026-08-23T00:00:00.000Z";
function conversation(title: string): ConversationRecord {
  return {
    id: conversationId,
    projectId: "proj_journal_test",
    title,
    mode: "coding",
    permissionLevel: "supervised",
    createdAt: now,
    updatedAt: now,
  };
}

test("guarded child results atomically advance only their own context and fence competing appends", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-child-guard-"));
  const journal = new ConversationJournalRepository({ paths: { home } });
  t.after(async () => {
    await journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const entries = new EntryRepository(journal);
  const root: ConversationEntry = {
    id: "entry_root_tip",
    conversationId,
    role: "user",
    kind: "message",
    text: "root",
    createdAt: now,
  };
  await journal.commit(conversationId, {
    kind: "conversation.created",
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: {
          ...conversation("Scoped guard"),
          activeEntryId: root.id,
        },
      },
      { kind: "conversation.entry_appended", conversationId, entry: root },
      ...["agent_child", "agent_sibling"].map((ownerAgentId) => ({
        kind: "model_context.entry_appended" as const,
        conversationId,
        ownerAgentId,
        entry: {
          type: "message" as const,
          id: `entry_tip_${ownerAgentId}`,
          parentId: null,
          timestamp: now,
          message: {
            role: "user" as const,
            content: ownerAgentId,
            timestamp: Date.parse(now),
          },
        },
      })),
    ],
  });
  const childTip = "entry_tip_agent_child";
  const result: ConversationEntry = {
    ...root,
    id: "entry_child_result",
    agentId: "agent_child",
    role: "system",
    kind: "tool_result",
    parentEntryId: childTip,
    text: "completed",
  };
  const model = {
    ownerAgentId: "agent_child",
    message: {
      role: "toolResult" as const,
      toolCallId: "call_child",
      toolName: "write",
      content: [{ type: "text" as const, text: "completed" }],
      isError: false,
      timestamp: Date.parse(now),
    },
  };
  await assert.rejects(
    entries.appendOnActiveBranch(
      { ...result, id: "entry_wrong_owner" },
      "entry_tip_agent_sibling",
      { ...model, ownerAgentId: "agent_sibling" },
    ),
    ConversationBranchConflictError,
  );
  // Root movement is unrelated to this child's checkpoint tip.
  const rootNext = { ...root, id: "entry_root_next", parentEntryId: root.id };
  await entries.appendOnActiveBranch(rootNext, root.id);
  const competing = { ...result, id: "entry_competing_result" };
  const [accepted, rejected] = await Promise.allSettled([
    entries.appendOnActiveBranch(result, childTip, model),
    entries.appendOnActiveBranch(competing, childTip, model),
  ]);
  assert.equal(accepted.status, "fulfilled");
  assert.equal(rejected.status, "rejected");
  if (rejected.status === "rejected")
    assert.ok(rejected.reason instanceof ConversationBranchConflictError);
  const state = await journal.loadFresh(conversationId);
  assert.equal(state.conversation?.activeEntryId, rootNext.id);
  assert.equal(state.modelLeafId, null);
  assert.equal(state.agentModelLeafIds.get("agent_child"), result.id);
  assert.equal(
    state.agentModelLeafIds.get("agent_sibling"),
    "entry_tip_agent_sibling",
  );
  assert.equal(state.entryById.get(result.id)?.parentEntryId, childTip);
  const context = state.agentModelEntries.get("agent_child")!;
  assert.equal(context.at(-1)?.id, result.id);
  assert.equal(context.at(-1)?.parentId, childTip);
  assert.equal(state.entryById.has(competing.id), false);
  assert.equal(state.entryById.has("entry_wrong_owner"), false);
  const revision = state.revision;
  await entries.appendOnActiveBranch(result, childTip, model);
  const replayed = await journal.loadFresh(conversationId);
  assert.equal(
    replayed.revision,
    revision,
    "receipt retry cannot append twice",
  );
  assert.equal(
    replayed.agentModelEntries
      .get("agent_child")!
      .filter((entry) => entry.id === result.id).length,
    1,
  );
  // A stale child guard cannot write transcript or model context either.
  await assert.rejects(
    entries.appendOnActiveBranch(
      { ...result, id: "entry_stale_child" },
      childTip,
      model,
    ),
    ConversationBranchConflictError,
  );
  const afterStale = await journal.loadFresh(conversationId);
  assert.equal(afterStale.revision, revision);
  assert.equal(afterStale.entryById.has("entry_stale_child"), false);
  assert.equal(
    afterStale.agentModelEntries
      .get("agent_child")!
      .some((entry) => entry.id === "entry_stale_child"),
    false,
  );
});

for (const scope of [
  "self",
  "lead",
  "binding-lead",
  "unowned",
  "missing",
  "ambiguous",
  "wrong-conversation",
  "wrong-owner",
] as const) {
  test(`root alias sibling guard classifies ${scope} from canonical ownership, not copied prefix or actor equality`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-journal-root-scope-"));
    const canonical = new CanonicalStore(join(home, "data", "nerve.sqlite"));
    const journal = new ConversationJournalRepository({
      paths: { home },
      canonicalStore: canonical,
    });
    t.after(async () => {
      await journal.close();
      await canonical.close();
      await rm(home, { recursive: true, force: true });
    });
    await canonical.initialize();
    const agent = (
      id: string,
      contextOwnerAgentId: string | null | undefined,
    ) =>
      agentRecordSchema.parse({
        id,
        contextOwnerAgentId,
        conversationId,
        projectId: "proj_journal_test",
        projectDir: home,
        rootAgentId: id,
        mode: "coding",
        permissionLevel: "supervised",
        workspaceScope: { roots: [home] },
        createdAt: now,
        updatedAt: now,
      });
    await canonical.writeDocument({
      namespace: "agent-context-binding",
      scopeId: "global",
      documentId: conversationId,
      data: { legacyRootAgentId: "agent_lead" },
      now,
    });
    await canonical.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: "agent_lead",
      data: agent("agent_lead", scope === "binding-lead" ? undefined : null),
      now,
    });
    const actorId =
      scope === "unowned"
        ? undefined
        : scope === "lead" || scope === "binding-lead"
          ? "agent_lead"
          : "agent_additional_root";
    if (actorId === "agent_additional_root" && scope !== "missing") {
      const record = agent(
        actorId,
        scope === "ambiguous"
          ? undefined
          : scope === "wrong-owner"
            ? "agent_other"
            : actorId,
      );
      if (scope === "wrong-conversation") record.conversationId = "conv_other";
      await canonical.writeDocument({
        namespace: "agent",
        scopeId: "global",
        documentId: actorId,
        data: record,
        now,
      });
    }
    const x: ConversationEntry = {
      id: "entry_shared_prefix_X",
      conversationId,
      agentId: "agent_lead",
      role: "user",
      kind: "message",
      text: "shared historical prefix",
      createdAt: now,
    };
    const prefix = {
      type: "message" as const,
      id: x.id,
      parentId: null,
      timestamp: now,
      message: {
        role: "user" as const,
        content: x.text,
        timestamp: Date.parse(now),
      },
    };
    await journal.commit(conversationId, {
      kind: "seed_copied_prefix",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: {
            ...conversation("Copied prefix"),
            activeEntryId: x.id,
          },
        },
        { kind: "conversation.entry_appended", conversationId, entry: x },
        { kind: "model_context.entry_appended", conversationId, entry: prefix },
        // Exactly the same IDs are valid in independent model-context partitions.
        {
          kind: "model_context.entry_appended",
          conversationId,
          ownerAgentId: actorId ?? "agent_additional_root",
          entry: prefix,
        },
      ],
    });
    const entries = new EntryRepository(journal);
    const y: ConversationEntry = {
      ...x,
      id: "entry_independent_prompt_Y",
      agentId: actorId,
      parentEntryId: x.id,
      text: "independent initial prompt",
    };
    await entries.append(y);
    await journal.commit(conversationId, {
      kind: "independent_context_advanced",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId,
          ownerAgentId: actorId ?? "agent_additional_root",
          entry: {
            ...prefix,
            id: y.id,
            parentId: x.id,
            message: { ...prefix.message, content: y.text },
          },
        },
      ],
    });
    const before = await journal.loadFresh(conversationId);
    assert.equal(before.conversation?.activeEntryId, x.id);
    assert.equal(before.modelLeafId, x.id);
    const result: ConversationEntry = {
      ...x,
      id: "entry_lead_result",
      parentEntryId: x.id,
      role: "system",
      kind: "tool_result",
      text: "lead completed",
    };
    const model = {
      message: {
        role: "toolResult" as const,
        toolCallId: "call_lead",
        toolName: "write",
        content: [{ type: "text" as const, text: result.text }],
        isError: false,
        timestamp: Date.parse(now),
      },
    };
    if (scope === "self") {
      await entries.appendOnActiveBranch(result, x.id, model);
      const after = await journal.loadFresh(conversationId);
      assert.equal(after.conversation?.activeEntryId, result.id);
      assert.equal(after.modelLeafId, result.id);
      assert.equal(after.agentModelLeafIds.get("agent_additional_root"), y.id);
      assert.equal(after.entryById.get(result.id)?.parentEntryId, x.id);
      const revision = after.revision;
      await entries.appendOnActiveBranch(result, x.id, model);
      assert.equal(
        (await journal.loadFresh(conversationId)).revision,
        revision,
      );
    } else {
      await assert.rejects(entries.appendOnActiveBranch(result, x.id, model));
      const after = await journal.loadFresh(conversationId);
      assert.equal(after.revision, before.revision);
      assert.equal(after.conversation?.activeEntryId, x.id);
      assert.equal(after.modelLeafId, x.id);
      assert.equal(after.entryById.has(result.id), false);
      assert.equal(
        after.modelEntries.some((entry) => entry.id === result.id),
        false,
      );
    }
  });
}

for (const ordering of [
  "legacy-before",
  "owned-after",
  "missing-receipt",
  "wrong-actor-receipt",
  "wrong-entry-receipt",
] as const) {
  test(`actual root partition migration preserves ${ordering} sibling scope through checkpoint/reopen`, async (t) => {
    const home = await mkdtemp(
      join(tmpdir(), "nerve-journal-migrated-sibling-"),
    );
    const storage = await initializeStorage(home);
    let journal = new ConversationJournalRepository(storage);
    t.after(async () => {
      await journal.close();
      await storage.canonicalStore.close();
      await rm(home, { recursive: true, force: true });
    });
    const extraId = "agent_legacy_additional_root";
    const leadId = "agent_legacy_lead";
    const makeAgent = (id: string, createdAt: string) =>
      agentRecordSchema.parse({
        id,
        conversationId,
        projectId: "proj_journal_test",
        projectDir: home,
        rootAgentId: id,
        executionKind: "root",
        mode: "coding",
        permissionLevel: "supervised",
        workspaceScope: { roots: [home] },
        createdAt,
        updatedAt: now,
      });
    for (const record of [
      makeAgent(leadId, now),
      makeAgent(extraId, "2026-08-23T00:00:00.001Z"),
    ]) {
      assert.equal(record.contextOwnerAgentId, undefined);
      await storage.canonicalStore.writeDocument({
        namespace: "agent",
        scopeId: "global",
        documentId: record.id,
        data: record,
        now,
      });
    }
    const x: ConversationEntry = {
      id: "entry_migration_shared_X",
      conversationId,
      agentId: leadId,
      role: "user",
      kind: "message",
      text: "lead checkpoint prefix",
      createdAt: now,
    };
    const prefix = {
      type: "message" as const,
      id: x.id,
      parentId: null,
      timestamp: now,
      message: {
        role: "user" as const,
        content: x.text,
        timestamp: Date.parse(now),
      },
    };
    await journal.commit(conversationId, {
      kind: "legacy_shared_prefix",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: {
            ...conversation("Legacy shared roots"),
            activeAgentId: leadId,
            activeEntryId: x.id,
          },
        },
        { kind: "conversation.entry_appended", conversationId, entry: x },
        { kind: "model_context.entry_appended", conversationId, entry: prefix },
      ],
    });
    const y: ConversationEntry = {
      ...x,
      id: "entry_migration_sibling_Y",
      agentId: extraId,
      parentEntryId: x.id,
      text: "additional root prompt",
    };
    if (ordering === "legacy-before") {
      // Interrupted unguarded append: no root metadata/model-leaf advancement.
      await new EntryRepository(journal).append(y);
    } else if (ordering !== "owned-after") {
      // Imported/ambiguous app data cannot manufacture a matching receipt.
      await journal.commit(conversationId, {
        kind: "historical_raw_app",
        events: [
          { kind: "conversation.entry_appended", conversationId, entry: y },
        ],
      });
    }
    await new AgentRepository(storage).loadAll();
    const lead = await storage.canonicalStore.readDocument<{
      contextOwnerAgentId: string | null;
    }>("agent", "global", leadId);
    const extra = await storage.canonicalStore.readDocument<{
      contextOwnerAgentId: string | null;
    }>("agent", "global", extraId);
    assert.equal(lead!.data.contextOwnerAgentId, null);
    assert.equal(extra!.data.contextOwnerAgentId, extraId);
    if (ordering === "owned-after") {
      await new EntryRepository(journal).append(y);
      await journal.commit(conversationId, {
        kind: "owned_model_append",
        events: [
          {
            kind: "model_context.entry_appended",
            conversationId,
            ownerAgentId: extraId,
            entry: {
              ...prefix,
              id: y.id,
              parentId: x.id,
              message: { ...prefix.message, content: y.text },
            },
          },
        ],
      });
    } else if (
      ordering === "wrong-actor-receipt" ||
      ordering === "wrong-entry-receipt"
    ) {
      // A valid typed commit/key is insufficient unless its event identifies Y
      // and Y's actor. Persist this collision so validation runs after replay.
      const wrong =
        ordering === "wrong-actor-receipt"
          ? { ...y, agentId: "agent_different_actor" }
          : {
              ...y,
              id: "entry_receipt_wrong_target",
              parentEntryId: undefined,
            };
      await journal.commit(conversationId, {
        kind: "conversation.entry_appended",
        idempotencyKey: `conversation-entry:${y.id}`,
        events: [
          { kind: "conversation.entry_appended", conversationId, entry: wrong },
        ],
      });
    }
    // Migration invalidates resident projections. Make a metadata-only commit
    // so checkpointLoaded actually folds the migration/receipt deltas, then
    // reopen to exercise persisted receipts rather than resident objects.
    await journal.commit(conversationId, {
      kind: "migration_checkpoint_boundary",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: (await journal.loadFresh(conversationId)).conversation!,
        },
      ],
    });
    await journal.checkpointLoaded();
    await journal.close();
    journal = new ConversationJournalRepository(storage);
    const before = await journal.loadFresh(conversationId);
    const migrationKey = `agent-context-prefix-copy:${extraId}:complete`;
    const completed = before.idempotencyKeys.get(migrationKey)!;
    assert.ok(completed);
    assert.equal(completed.kind, "agent.context_prefix_migrated");
    assert.equal(completed.conversationId, conversationId);
    assert.equal(completed.events[0]!.kind, "model_context.leaf_changed");
    if (completed.events[0]!.kind === "model_context.leaf_changed")
      assert.equal(completed.events[0]!.ownerAgentId, extraId);
    const receipt = before.idempotencyKeys.get(`conversation-entry:${y.id}`);
    if (ordering === "legacy-before")
      assert.ok(receipt!.revision < completed.revision);
    if (ordering === "owned-after")
      assert.ok(receipt!.revision > completed.revision);
    if (ordering === "missing-receipt") assert.equal(receipt, undefined);
    assert.equal(
      await storage.canonicalStore.readDocument(
        "agent-context-prefix-migration",
        conversationId,
        extraId,
      ),
      undefined,
    );
    assert.equal(before.conversation!.activeEntryId, x.id);
    assert.equal(before.modelLeafId, x.id);
    assert.equal(
      before.modelEntryById.has(y.id),
      false,
      "root model membership cannot prove the pre-model crash window",
    );
    assert.equal(before.entryById.get(y.id)!.agentId, extraId);
    const result: ConversationEntry = {
      ...x,
      id: "entry_migration_lead_result",
      parentEntryId: x.id,
      role: "system",
      kind: "tool_result",
      text: "lead result",
    };
    const model = {
      message: {
        role: "toolResult" as const,
        toolCallId: "call_lead",
        toolName: "write",
        content: [{ type: "text" as const, text: result.text }],
        isError: false,
        timestamp: Date.parse(now),
      },
    };
    if (ordering === "owned-after") {
      await new EntryRepository(journal).appendOnActiveBranch(
        result,
        x.id,
        model,
      );
      const after = await journal.loadFresh(conversationId);
      assert.equal(after.conversation!.activeEntryId, result.id);
      assert.equal(after.modelLeafId, result.id);
      assert.equal(after.agentModelLeafIds.get(extraId), y.id);
      const revision = after.revision;
      await new EntryRepository(journal).appendOnActiveBranch(
        result,
        x.id,
        model,
      );
      assert.equal(
        (await journal.loadFresh(conversationId)).revision,
        revision,
      );
    } else {
      await assert.rejects(
        new EntryRepository(journal).appendOnActiveBranch(result, x.id, model),
        ConversationBranchConflictError,
      );
      const after = await journal.loadFresh(conversationId);
      assert.equal(after.revision, before.revision);
      assert.equal(after.conversation!.activeEntryId, x.id);
      assert.equal(after.modelLeafId, x.id);
      assert.equal(after.entryById.has(result.id), false);
      assert.equal(after.modelEntryById.has(result.id), false);
    }
  });
}
