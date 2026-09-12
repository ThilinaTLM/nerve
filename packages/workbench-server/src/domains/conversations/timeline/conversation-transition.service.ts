import type {
  ContextBoundary,
  ConversationTransition,
  MutationOutcome,
} from "@nervekit/contracts/conversations";
import type {
  CanonicalCheckpoint,
  ImmutableExecutionSnapshot,
  ProviderPhase,
  RunControl,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type {
  TimelineExpectedHead,
  TimelineExpectedRunFence,
  TimelinePublicationIntent,
} from "../../../infrastructure/persistence/canonical-sqlite/timeline-database.js";
import type { TimelineArtifactManifestWrite } from "../../../infrastructure/persistence/canonical-sqlite/timeline-checkpoint-database.js";

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
  expectedRunFences?: TimelineExpectedRunFence[];
  transitions: ConversationTransition[];
  contextBoundaries?: ContextBoundary[];
  artifactManifests?: TimelineArtifactManifestWrite[];
  runControls?: RunControl[];
  executionSnapshots?: ImmutableExecutionSnapshot[];
  waitGroups?: WaitGroup[];
  checkpoints?: CanonicalCheckpoint[];
  providerPhases?: ProviderPhase[];
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
