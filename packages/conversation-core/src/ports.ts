import type { AgentProfileCompactionOverride } from "@nervekit/contracts/agent-profiles";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { AgentProfilesDocument } from "@nervekit/contracts/agent-profiles";
import type { ModelSelection } from "@nervekit/contracts/models";
import type {
  CommandResult,
  Conversation,
  ConversationConfig,
  Supervision,
  ToolCallOrigin,
  ToolProgress,
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
  agentProfileOverrides?: AgentProfilesDocument;
}

export interface TurnResourcesPort {
  prepare(
    input: TurnPreparationInput & {
      coreTools?: ToolDefinition[];
    },
  ): Promise<{ systemPrompt: string; tools: ToolDefinition[] }>;
}

export interface PermissionPort {
  evaluate(input: {
    conversationId: string;
    projectDir: string;
    ruleSetId: string;
    toolName: string;
    origin: ToolCallOrigin;
    args: unknown;
    cwd: string;
  }): Promise<Supervision>;
  addRule(input: {
    scope: "conversation" | "project" | "user";
    conversationId: string;
    projectDir: string;
    ruleSetId: string;
    rule: unknown;
  }): Promise<void>;
}

export interface ToolHostPort {
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

/** Locks are effective overrides only: do not persist them into conversation config. */
export type AgentProfileLockedScalars = Partial<
  Pick<ConversationConfig, "model" | "reasoningLevel" | "permissionRuleSetId">
> & { compaction?: AgentProfileCompactionOverride };

/** Host resolves defaults and returns the changes core must persist on a switch. */
export interface AgentProfileConfigPatch {
  config: Partial<Omit<ConversationConfig, "conversationId">> & {
    agentProfile: string;
  };
  /** Null removes the stored conversation compaction override. */
  compaction?: AgentProfileCompactionOverride | null;
  capabilityOverrides?: CapabilityOverridesDocument;
}

/** Profile policy belongs to the host; core owns persistence and turn lifecycle. */
export interface AgentProfilePort {
  resolveLockedScalars(
    input: TurnPreparationInput,
  ): Promise<AgentProfileLockedScalars>;
  /** Omit profile to select the settings default lead profile (e.g. after plan approval). */
  switchProfile(
    input: TurnPreparationInput & { profile?: string },
  ): Promise<AgentProfileConfigPatch>;
}
