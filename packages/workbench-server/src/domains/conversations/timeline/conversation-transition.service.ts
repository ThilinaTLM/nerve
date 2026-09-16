import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CommitConversationCommandInput } from "../../../infrastructure/persistence/canonical-sqlite/timeline-command-contracts.js";

export type CommitConversationTransitionCommand =
  CommitConversationCommandInput;

/**
 * Sole target-runtime entry point for correctness-critical conversation
 * mutations. Preparation and external IO happen before this boundary.
 */
export class ConversationTransitionService {
  constructor(private readonly store: CanonicalStore) {}

  commit(
    command: CommitConversationTransitionCommand,
  ): Promise<MutationOutcome> {
    return this.store.commitConversationCommand(command);
  }
}
