import {
  agentContextPrefixMigrationSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";

/** Copy a historical shared prefix before publishing an isolated owner binding.
 * The durable source snapshot plus journal batch receipts fence crash/retry windows.
 * A fresh root never calls this migration; an existing owned tree is never reset.
 */
export async function preserveLegacyRootContext(
  storage: InitializedStorage,
  agent: AgentRecord,
): Promise<void> {
  const journal = new ConversationJournalRepository({
    canonicalStore: storage.canonicalStore,
    paths: { home: storage.paths?.home ?? "" },
  });
  try {
    const namespace = "agent-context-prefix-migration";
    const key = `agent-context-prefix-copy:${agent.id}`;
    const state = await journal.load(agent.conversationId);
    const completed = state.idempotencyKeys.has(`${key}:complete`);
    let document = await storage.canonicalStore.readDocument(
      namespace,
      agent.conversationId,
      agent.id,
    );
    if (completed) {
      if (document)
        await storage.canonicalStore.deleteDocument(
          namespace,
          agent.conversationId,
          agent.id,
        );
      return;
    }
    // An already-owned historical tree is authoritative, not a missing shared prefix.
    if (!document && (state.agentModelEntries.get(agent.id)?.length ?? 0) > 0)
      return;
    if (!document) {
      const snapshot = agentContextPrefixMigrationSchema.parse({
        sourceRevision: state.revision,
        entries: state.modelEntries,
        leafId: state.modelLeafId,
      });
      try {
        await storage.canonicalStore.writeDocument({
          namespace,
          scopeId: agent.conversationId,
          documentId: agent.id,
          data: snapshot,
          expectedRevision: 0,
          now: agent.updatedAt,
        });
      } catch (error) {
        // Concurrent startup may have fixed the same immutable source already.
        if (
          !(await storage.canonicalStore.readDocument(
            namespace,
            agent.conversationId,
            agent.id,
          ))
        )
          throw error;
      }
      document = await storage.canonicalStore.readDocument(
        namespace,
        agent.conversationId,
        agent.id,
      );
    }
    if (!document)
      throw new Error(
        "Legacy agent context migration source was not persisted",
      );
    const snapshot = agentContextPrefixMigrationSchema.parse(document.data);
    // Journal commits are bounded to 256 events; retain all entries, not just active path.
    for (let offset = 0; offset < snapshot.entries.length; offset += 256) {
      await journal.commit(agent.conversationId, {
        kind: "agent.context_prefix_migrated",
        idempotencyKey: `${key}:entries:${offset}`,
        events: snapshot.entries.slice(offset, offset + 256).map((entry) => ({
          kind: "model_context.entry_appended",
          conversationId: agent.conversationId,
          ownerAgentId: agent.id,
          entry,
        })),
      });
      ConversationJournalRepository.invalidateMigratedConversation(
        storage.canonicalStore,
        agent.conversationId,
      );
    }
    // A separate durable receipt restores the exact legacy leaf, including detached branches.
    await journal.commit(agent.conversationId, {
      kind: "agent.context_prefix_migrated",
      idempotencyKey: `${key}:complete`,
      events: [
        {
          kind: "model_context.leaf_changed",
          conversationId: agent.conversationId,
          ownerAgentId: agent.id,
          entryId: snapshot.leafId,
        },
      ],
    });
    ConversationJournalRepository.invalidateMigratedConversation(
      storage.canonicalStore,
      agent.conversationId,
    );
    await storage.canonicalStore.deleteDocument(
      namespace,
      agent.conversationId,
      agent.id,
    );
  } finally {
    await journal.close();
  }
}
