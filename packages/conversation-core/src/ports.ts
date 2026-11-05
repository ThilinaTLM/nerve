import type { ModelSelection } from "@nervekit/contracts/models";
import type {
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

export type ProcessReadinessResult = {
  status: "ready" | "timed_out" | "exited";
  url?: string;
};

export interface ProcessPort {
  // Capture output under artifactDir. A rejected start must clean up its process.
  // After return, cancel() owns its lifetime.
  start(input: {
    /** Host resolves conversation-scoped bash configuration, including shellPath. */
    conversationId: string;
    command: string;
    cwd: string;
    signal: AbortSignal;
    artifactDir: string;
    env?: Record<string, string>;
    projectEnvironment?: boolean;
    timeoutMs?: number;
  }): Promise<BackgroundProcess>;
  // Readiness is a policy over a running process, so the host runs it as a separate step
  // callers invoke right after `start`. A rejection (including abort) cancels the process.
  awaitReadiness(
    process: BackgroundProcess,
    ready: ProcessReadiness,
    signal: AbortSignal,
  ): Promise<ProcessReadinessResult>;
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
  /** Both streams in arrival order; the only capture file. */
  outputFiles: { combined: string };
}

export interface ClockPort {
  now(): string;
}
export type { ToolProgress } from "@nervekit/contracts/core";
