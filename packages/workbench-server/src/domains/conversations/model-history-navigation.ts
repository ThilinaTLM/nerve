import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import { ConversationError } from "@nervekit/harness";
import { ApplicationError } from "../../core/application-error.js";

export class ModelHistoryInvalidError extends ApplicationError {
  constructor(
    message = "Owner history leaf/ancestor is missing from its model tree.",
  ) {
    super(409, "MODEL_HISTORY_INVALID", message);
    this.name = "ModelHistoryInvalidError";
  }
}

/** Only recognized model-tree integrity errors are preparation failures.
 * I/O/cache failures and arbitrary messages retain their existing semantics.
 */
export function modelHistoryIntegrityError(
  error: unknown,
): ModelHistoryInvalidError | undefined {
  if (error instanceof ModelHistoryInvalidError) return error;
  if (
    error instanceof ConversationError &&
    error.code === "invalid_conversation"
  )
    return new ModelHistoryInvalidError(error.message);
  return undefined;
}

/** The supplied index is an owner-specific model tree, never transcript ancestry.
 * Detached legacy compactions are normalized by the journal owning layer.
 */
export function validateModelHistoryPath(
  entriesById: ReadonlyMap<string, ConversationTreeEntry>,
  leafId: string | null,
): ConversationTreeEntry[] {
  const path: ConversationTreeEntry[] = [];
  const visited = new Set<string>();
  let cursor = leafId;
  while (cursor !== null) {
    if (visited.has(cursor))
      throw new ModelHistoryInvalidError(
        "Owner history contains an ancestry cycle.",
      );
    visited.add(cursor);
    const entry = entriesById.get(cursor);
    if (!entry || entry.id !== cursor) throw new ModelHistoryInvalidError();
    path.push(entry);
    cursor = entry.parentId;
  }
  return path.reverse();
}

export interface NavigationCommitGuard {
  agentId: string;
  ownerAgentId?: string;
  expectedActiveEntryId: string | null;
  expectedModelLeafId: string | null;
  targetEntryId: string | null;
  requireValidSource: boolean;
}

export class StaleNavigationError extends ApplicationError {
  constructor() {
    super(
      409,
      "STALE_NAVIGATION",
      "Conversation selection or model context changed before navigation.",
    );
    this.name = "StaleNavigationError";
  }
}

export function validateNavigationTarget(
  entriesById: ReadonlyMap<string, ConversationTreeEntry>,
  targetEntryId: string | null,
): ConversationTreeEntry[] {
  try {
    return validateModelHistoryPath(entriesById, targetEntryId);
  } catch (error) {
    if (!(error instanceof ModelHistoryInvalidError)) throw error;
    throw new ApplicationError(
      400,
      "INVALID_NAVIGATION_TARGET",
      "Navigation target is not a complete owned model path.",
    );
  }
}
