import type {
  ArtifactReference,
  ContextBoundary,
  ConversationTransition,
} from "@nervekit/contracts/conversations";
import type {
  PolicyDiagnostic,
  PolicyDocumentObservation,
  PolicyFallbackDecision,
  PolicySaveIntent,
} from "@nervekit/contracts/permissions";
import type {
  CanonicalCheckpoint,
  CanonicalExecutionAttempt,
  ExactCallAuthorization,
  ExecutionClaim,
  ImmutableExecutionSnapshot,
  LogicalEffect,
  ProviderPhase,
  RecoveryAction,
  RunControl,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { TimelineArtifactManifestWrite } from "./timeline-checkpoint-database.js";

export interface TimelineExpectedHead {
  conversationId: string;
  revision: number;
  selectionEpoch: number;
  createIfMissing?: boolean;
}

export interface TimelineExpectedRunFence {
  conversationId: string;
  runId: string;
  generation: number;
  revision: number;
  selectionEpoch: number;
  continuationEntryId: string | null;
  requireForegroundOwnership: boolean;
}

export interface TimelinePublicationIntent {
  intentId: string;
  stream: string;
  eventType: string;
  occurredAt: string;
  conversationId?: string;
  data: unknown;
}

export interface CommitConversationCommandInput {
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
  finalizedArtifacts?: ArtifactReference[];
  artifactManifests?: TimelineArtifactManifestWrite[];
  runControls?: RunControl[];
  executionSnapshots?: ImmutableExecutionSnapshot[];
  waitGroups?: WaitGroup[];
  checkpoints?: CanonicalCheckpoint[];
  policyObservations?: PolicyDocumentObservation[];
  policyDiagnostics?: PolicyDiagnostic[];
  policyFallbackDecisions?: PolicyFallbackDecision[];
  policySaveIntents?: PolicySaveIntent[];
  authorizations?: ExactCallAuthorization[];
  logicalEffects?: LogicalEffect[];
  providerPhases?: ProviderPhase[];
  executionAttempts?: CanonicalExecutionAttempt[];
  executionClaims?: ExecutionClaim[];
  recoveryActions?: RecoveryAction[];
  outcome: unknown;
  publicationIntents: TimelinePublicationIntent[];
  now: string;
}
