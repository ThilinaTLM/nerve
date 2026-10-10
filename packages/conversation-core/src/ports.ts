import type { ModelSelection } from "@nervekit/contracts/models";
import type {
  CommandResult,
  Conversation,
  ConversationConfig,
  Supervision,
  ToolProgress,
} from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";
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

export interface TurnResourcesPort {
  prepare(input: {
    conversation: Conversation;
    config: ConversationConfig;
    projectDir: string;
    coreTools?: ToolDefinition[];
  }): Promise<{ systemPrompt: string; tools: ToolDefinition[] }>;
}

export interface PermissionPort {
  evaluate(input: {
    conversationId: string;
    projectDir: string;
    ruleSetId: string;
    toolName: string;
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
  ref: string;
  wait(): Promise<{
    exitCode: number | null;
    status: "completed" | "failed" | "timed_out" | "cancelled";
  }>;
  cancel(): Promise<void>;
  outputFiles: { stdout: string; stderr: string };
}

export interface ClockPort {
  now(): string;
}
export type { CommandResult, ToolProgress } from "@nervekit/contracts/core";
