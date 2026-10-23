import type {
  AppliedAgentProfile,
  AgentProfilesDraft,
} from "@nervekit/contracts/agent-profiles";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import type { ModelSelection } from "@nervekit/contracts/models";
import type {
  CommandResult,
  Conversation,
  ConversationConfig,
  Supervision,
  ToolCallOrigin,
  ToolProgress,
  ToolAdmissionEvidence,
  ConfigurationBlockedRequest,
} from "@nervekit/contracts/core";
import type {
  ProjectShellLaunchContext,
  ToolExecutionResultPayload,
} from "@nervekit/contracts/tools";
import type { getRegisteredModel } from "@nervekit/harness/models";
import type { ToolDefinition } from "@nervekit/tools/catalog";

// Obtain Pi's Model<string> through the harness's public surface, without a second Pi dependency.
export type PiModel = NonNullable<ReturnType<typeof getRegisteredModel>>;

export interface ModelPort {
  resolve(selection: ModelSelection): Promise<{
    model: PiModel;
    apiKey?: string;
    headers?: Record<string, string>;
  }>;
}

export interface TurnPreparationInput {
  conversation: Pick<Conversation, "projectId" | "parentConversationId"> & {
    id?: string;
  };
  config: Omit<ConversationConfig, "conversationId">;
  projectDir: string;
  capabilityOverrides?: CapabilityOverridesDocument;
  agentProfileOverrides?: AgentProfilesDraft;
  appliedAgentProfile?: AppliedAgentProfile | null;
}

export interface TurnResourcesPort {
  prepare(
    input: TurnPreparationInput & {
      coreTools?: ToolDefinition[];
    },
  ): Promise<{ systemPrompt: string; tools: ToolDefinition[] }>;
}

export interface ExecutionAdmissionInput {
  toolCallId: string;
  conversationId: string;
  projectDir: string;
  toolName: string;
  origin: ToolCallOrigin;
  args: unknown;
  cwd: string;
  /** Actual prepared, non-secret target, never credentials. */
  target: unknown;
  requestCaptureId?: string;
}
export type ExecutionAdmission =
  | { kind: "stale" }
  | { kind: "blocked"; request: ConfigurationBlockedRequest }
  | {
      kind: "policy";
      supervision: Supervision;
      evidence: ToolAdmissionEvidence;
    };

export interface PermissionPort {
  /** Async loading only. check must read current memory and never perform IO. */
  prepareAdmission?(input: ExecutionAdmissionInput): Promise<{
    check(): ExecutionAdmission;
  }>;
  addRule(input: {
    scope: "conversation" | "project" | "user";
    conversationId: string;
    projectDir: string;
    ruleSetId: string;
    rule: unknown;
  }): Promise<void>;
}

export interface ToolHostPort {
  /** Prepare all execution context asynchronously; dispatch must not reselect a target. */
  prepareExecution?(input: Parameters<ToolHostPort["execute"]>[0]): Promise<
    | {
        args: unknown;
        cwd: string;
        target: unknown;
        dispatch(): ReturnType<ToolHostPort["execute"]>;
      }
    | { kind: "configuration_blocked"; request: ConfigurationBlockedRequest }
  >;
  execute(input: {
    toolCallId: string;
    conversationId: string;
    origin: ToolCallOrigin;
    projectDir?: string;
    toolName: string;
    args: unknown;
    cwd: string;
    signal: AbortSignal;
    onProgress(update: ToolProgress): void;
    artifactDir: string;
    requestCaptureId?: string;
  }): Promise<
    | { kind: "completed"; result: ToolExecutionResultPayload }
    | {
        kind: "backgrounded";
        process: BackgroundProcess;
        result: ToolExecutionResultPayload;
      }
  >;
  isReplaySafe(toolName: string): boolean;
}

export type ProcessReadiness =
  | { kind: "url"; url: string; timeoutMs?: number }
  | { kind: "detected_url"; timeoutMs?: number }
  | { kind: "pattern"; pattern: string; timeoutMs?: number };

export interface ProcessPort {
  // Capture output under artifactDir and perform readiness detection in the host.
  // A rejected start must clean up its process. After return, cancel() owns its lifetime.
  start(input: {
    /** Host resolves conversation-scoped bash configuration, including shellPath. */
    conversationId: string;
    command: string;
    cwd: string;
    signal: AbortSignal;
    artifactDir: string;
    env?: Record<string, string>;
    projectEnvironment?: boolean;
    ready?: ProcessReadiness;
    timeoutMs?: number;
  }): Promise<{
    process: BackgroundProcess;
    readiness?: { status: "ready" | "timed_out" | "exited"; url?: string };
  }>;
  run(input: {
    conversationId: string;
    command: string;
    cwd: string;
    signal: AbortSignal;
  }): Promise<CommandResult>;
  reattach(processRef: string): Promise<BackgroundProcess | null>;
}

export interface BackgroundProcess {
  launch?: ProjectShellLaunchContext;
  ref: string;
  wait(): Promise<{
    exitCode: number | null;
    status: "completed" | "failed" | "timed_out" | "cancelled";
  }>;
  cancel(): Promise<void>;
  outputFiles: { stdout: string; stderr: string; combined?: string };
}

export interface ClockPort {
  now(): string;
}
export type { CommandResult, ToolProgress } from "@nervekit/contracts/core";

/** Fully materialized template application. Host persists files; core persists scalar config. */
export interface AgentProfileApplication {
  config: Partial<
    Pick<ConversationConfig, "model" | "reasoningLevel" | "permissionRuleSetId">
  > & { agentProfile: string };
  compaction?: AutoCompactionSettings;
  capabilityOverrides?: CapabilityOverridesDocument;
  applied: AppliedAgentProfile;
}
/** No live profile lookups on turns. Applied policy is an independent persisted snapshot. */
export interface AgentProfilePort {
  applyProfile(
    input: TurnPreparationInput & {
      profile?: string;
      preserveModel?: boolean;
      preserveThinking?: boolean;
    },
  ): Promise<AgentProfileApplication>;
  /** Persist compaction/capabilities and applied-agent-profile.json before returning. */
  persistApplication(
    conversationId: string,
    application: AgentProfileApplication,
  ): Promise<void>;
  /** Synchronous snapshot access lets existing configure and snapshot paths enforce/report locks. */
  getAppliedProfile(conversationId: string): AppliedAgentProfile | null;
}
