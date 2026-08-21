import type { ThinkingLevel } from "../agent/types/index.js";

export interface AgentModelSelection {
  provider: string;
  modelId: string;
}

export interface AgentModelInfo extends AgentModelSelection {
  name: string;
  reasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  /** Accepted input modalities from the model catalog; `["text"]` when unknown. */
  input: ("text" | "image")[];
  contextWindow: number;
  maxOutputTokens: number;
}

/**
 * A user-defined model (custom provider or manually-added model). The
 * orchestrator owns persistence; the runtime turns these into pi-ai `Model`
 * objects. Custom providers supply explicit connection settings; manual models
 * under built-in providers can inherit settings from pi-ai's provider catalog.
 */
export interface AgentCustomModel {
  provider: string;
  modelId: string;
  name: string;
  api?: string;
  baseUrl?: string;
  reasoning: boolean;
  supportedThinkingLevels?: ThinkingLevel[];
  thinkingLevelMap?: Record<string, string | null>;
  input?: ("text" | "image")[];
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: Array<{
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };
  contextWindow?: number;
  maxTokens?: number;
  samplingParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export type AgentScriptedProviderStep =
  | { type: "assistantText"; text?: string; chunks?: string[] }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | {
      type: "toolCalls";
      calls: Array<{ id: string; name: string; args: unknown }>;
    }
  | { type: "providerError"; message: string; retryable?: boolean }
  | { type: "waitForAbort" };
