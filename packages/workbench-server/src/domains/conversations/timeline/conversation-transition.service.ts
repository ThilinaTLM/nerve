import type {
  ConversationTransition,
  MutationOutcome,
} from "@nervekit/contracts/conversations";
import type { RunControl } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type {
  TimelineExpectedHead,
  TimelinePublicationIntent,
} from "../../../infrastructure/persistence/canonical-sqlite/timeline-database.js";

export interface CommitConversationTransitionCommand {
  namespaceId: string;
  executionIncarnationId: string;
  operationKind: string;
  ownerKind: "state" | "conversation" | "policy_scope";
  ownerId: string;
  commandId: string;
  fingerprintVersion: number;
  fingerprint: string;
  expectedHeads: TimelineExpectedHead[];
  transitions: ConversationTransition[];
  runControls?: RunControl[];
  outcome: unknown;
  publicationIntents: TimelinePublicationIntent[];
  now: string;
}

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
