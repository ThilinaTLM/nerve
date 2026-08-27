import type {
  AgentProjectionSnapshot,
  AgentResultProfileId,
  AgentResultStrategyId,
  ExactContinuation,
  ProjectionCount,
  ToolCallErrorDetails,
  ToolCallStatus,
  ToolPhase,
  ValidatedToolArtifact,
} from "@nervekit/contracts";

export type ProjectableBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type SemanticItem = {
  id?: string;
  blocks: ProjectableBlock[];
  countsAs: "item" | "event" | "task" | "artifact";
  continuation?: ExactContinuation[];
  rawRecovery?: { artifactId: string; startByte: number; endByte: number };
};

export type ProjectionCandidate = {
  blocks: ProjectableBlock[];
  status?: ProjectableBlock[];
  items?: SemanticItem[];
  overflow?: {
    noun: string;
    guidance?: string;
  };
  taskLog?: {
    mode: string;
    failureSeq?: number;
    originalEventCount: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    eventsArtifactId?: string;
  };
  sections?: Array<{
    id: string;
    priority: number;
    blocks: ProjectableBlock[];
  }>;
  tasks?: Array<{ index: number; candidate: ProjectionCandidate }>;
  continuation?: ExactContinuation[];
  counts?: ProjectionCount[];
  artifacts: ValidatedToolArtifact[];
};

export type CandidateContext = {
  toolName: string;
  args: unknown;
  result: unknown;
  status: ToolCallStatus;
  phase?: ToolPhase;
  error?: string;
  errorDetails?: ToolCallErrorDetails;
  validatedArtifacts: readonly ValidatedToolArtifact[];
  completePayload?: ValidatedToolArtifact;
};

export type CandidateBuilder = (
  input: CandidateContext,
) => ProjectionCandidate | undefined;

export type TerminalResource = {
  label: string;
  state?: string;
};

export type AgentResultPolicy = {
  readonly profile:
    | AgentResultProfileId
    | ((input: CandidateContext) => AgentResultProfileId);
  readonly buildCandidate: CandidateBuilder;
  readonly overflow: AgentResultStrategyId;
  readonly terminalResource?: (
    input: CandidateContext,
  ) => TerminalResource | undefined;
};

export type ProjectedToolResult = {
  blocks: ProjectableBlock[];
  snapshot: AgentProjectionSnapshot;
};
