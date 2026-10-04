import { AsyncLocalStorage } from "node:async_hooks";
import type { CheckpointDetails } from "@nervekit/contracts/conversations";
import type {
  Conversation,
  ConversationTreeEntry,
  MessageEntry,
} from "@nervekit/harness/conversation";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { resolveCompactionOwner } from "./compaction-owner.js";

export type PromptAnchor = NonNullable<MessageEntry["compactionAnchor"]>;
const promptProvenance = new AsyncLocalStorage<{
  scope: string;
  anchor: PromptAnchor;
  consumed: boolean;
}>();

/** A foreground prompt contributes exactly one user entry, not its generated continuations. */
export function withPromptCompactionAnchor<T>(
  agent: AgentRecord,
  anchor: PromptAnchor,
  append: () => Promise<T>,
): Promise<T> {
  return promptProvenance.run(
    {
      scope: resolveCompactionOwner(agent.conversationId, agent).key,
      anchor,
      consumed: false,
    },
    append,
  );
}

export function applyPromptCompactionAnchor(
  entry: ConversationTreeEntry,
  scope: string,
): ConversationTreeEntry {
  const provenance = promptProvenance.getStore();
  if (
    entry.type !== "message" ||
    entry.message.role !== "user" ||
    !provenance ||
    provenance.scope !== scope ||
    provenance.consumed
  )
    return entry;
  provenance.consumed = true;
  return { ...entry, compactionAnchor: provenance.anchor };
}

export async function foregroundPromptAnchor(
  conversation: Conversation,
  agent: AgentRecord,
): Promise<PromptAnchor> {
  const branch = await conversation.getBranch();
  const child =
    resolveCompactionOwner(agent.conversationId, agent).ownerAgentId !==
    undefined;
  const initialKind = child ? "assignment" : "request";
  const hasInitial = branch.some(
    (entry) =>
      entry.compactionAnchor?.kind === initialKind ||
      (entry.type === "compaction" &&
        [
          ...((entry.details as CheckpointDetails | undefined)?.anchors ?? []),
          ...((entry.details as CheckpointDetails | undefined)
            ?.anchorOverflow ?? []),
        ].some((anchor) => anchor.kind === initialKind)),
  );
  return { kind: hasInitial ? "steering" : initialKind };
}
