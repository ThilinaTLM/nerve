import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationTree } from "@nervekit/contracts/conversations";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import type { ConversationJournalRepository } from "./conversation-journal.repository.js";
import { resolveCompactionOwner } from "./compaction-owner.js";
import { validateModelHistoryPath } from "./model-history-navigation.js";

export interface ModelNavigationCapabilitiesDeps {
  journal: Pick<ConversationJournalRepository, "load">;
  /** Persisted policy: unique eligible conversation-control agent, never an agent-kind check.
   * Undefined means no agents; missing/ambiguous/ineligible owners must reject.
   */
  resolveControlAgent(conversationId: string): Promise<AgentRecord | undefined>;
}

/** Linear parent-graph classification, including missing ancestors and cycles.
 * The selected-owner map is authoritative; transcript ancestry is never consulted.
 */
function validModelPaths(
  entries: ReadonlyMap<string, ConversationTreeEntry>,
): Map<string, boolean> {
  const valid = new Map<string, boolean>();
  for (const id of entries.keys()) {
    if (valid.has(id)) continue;
    const pending: string[] = [];
    const visiting = new Set<string>();
    let cursor: string | null = id;
    let result = true;
    while (cursor !== null) {
      if (valid.has(cursor)) {
        result = valid.get(cursor)!;
        break;
      }
      const entry = entries.get(cursor);
      if (!entry || entry.id !== cursor || visiting.has(cursor)) {
        result = false;
        break;
      }
      visiting.add(cursor);
      pending.push(cursor);
      cursor = entry.parentId;
    }
    for (const pendingId of pending) valid.set(pendingId, result);
  }
  return valid;
}

function unavailable(tree: ConversationTree): ConversationTree {
  return {
    ...tree,
    navigation: {
      agentId: null,
      ownerAgentId: null,
      contextState: "unavailable",
      activeModelEntryId: null,
      canNavigateToRoot: false,
      problem: {
        code: "NAVIGATION_OWNER_UNAVAILABLE",
        message: "Conversation model navigation is unavailable for this owner.",
      },
    },
    nodes: tree.nodes.map((node) => ({
      ...node,
      navigation: { continueTarget: null, editTarget: null },
    })),
  };
}

/** Read-only enrichment. Invalid current leaves expose valid explicit repair targets. */
export class ModelNavigationCapabilities {
  constructor(private readonly deps: ModelNavigationCapabilitiesDeps) {}

  async enrich(tree: ConversationTree): Promise<ConversationTree> {
    try {
      const [state, agent] = await Promise.all([
        this.deps.journal.load(tree.conversationId),
        this.deps.resolveControlAgent(tree.conversationId),
      ]);
      if (state.conversationId !== tree.conversationId)
        return unavailable(tree);
      if (!agent) {
        if (
          tree.nodes.length ||
          tree.activeEntryId ||
          state.conversation?.activeEntryId ||
          state.entries.length ||
          state.modelEntryById.size ||
          state.modelLeafId !== null
        )
          return unavailable(tree);
        return {
          ...unavailable(tree),
          navigation: {
            agentId: null,
            ownerAgentId: null,
            contextState: "valid",
            activeModelEntryId: null,
            canNavigateToRoot: true,
          },
        };
      }
      const owner = resolveCompactionOwner(tree.conversationId, agent);
      // Current conversation controls do not authorize isolated or shared-child branching.
      if (
        agent.parentAgentId ||
        agent.contextOwnerAgentId !== null ||
        owner.ownerAgentId !== undefined
      )
        return unavailable(tree);
      const entries = state.modelEntryById;
      const leafId = state.modelLeafId;
      let contextState: "valid" | "invalid" = "valid";
      try {
        validateModelHistoryPath(entries, leafId);
      } catch {
        contextState = "invalid";
      }
      const paths = validModelPaths(entries);
      return {
        ...tree,
        navigation: {
          agentId: agent.id,
          ownerAgentId: owner.ownerAgentId ?? null,
          contextState,
          activeModelEntryId: leafId,
          canNavigateToRoot: true,
          ...(contextState === "invalid"
            ? {
                problem: {
                  code: "MODEL_HISTORY_INVALID",
                  message:
                    "Selected model history has a missing or invalid ancestor. Choose a verified history target or root.",
                },
              }
            : {}),
        },
        nodes: tree.nodes.map((node) => {
          const model = entries.get(node.entry.id);
          const supported =
            node.entry.conversationId === tree.conversationId &&
            model &&
            paths.get(model.id) === true;
          return {
            ...node,
            navigation: {
              continueTarget: supported ? { activeEntryId: model.id } : null,
              editTarget:
                supported &&
                model.type === "message" &&
                model.message.role === "user"
                  ? { activeEntryId: model.parentId }
                  : null,
            },
          };
        }),
      };
    } catch {
      // Auxiliary capability availability must not erase a readable canonical snapshot.
      return unavailable(tree);
    }
  }
}
