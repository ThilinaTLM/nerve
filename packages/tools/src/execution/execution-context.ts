import type {
  ConversationLiveToolOutputStream,
  ToolContentBlockPayload,
  ToolExecutionResultPayload,
  ToolImageContentPayload,
  ToolTextContentPayload,
} from "@nervekit/contracts";
import type { PythonRuntime } from "./python/runtime.js";

export type ToolExecutionOutputUpdate = {
  kind: "output";
  stream: ConversationLiveToolOutputStream;
  chunk: string;
};

export type ExplainImageRequest = {
  path: string;
  data: Uint8Array;
  mimeType: string;
  prompt?: string;
  signal?: AbortSignal;
  onUpdate?: (update: ToolExecutionOutputUpdate) => void | Promise<void>;
};

export type ExplainImageResponse = {
  explanation: string;
  model: { provider: string; modelId: string };
};

export interface BaseExecutionContext {
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: (update: ToolExecutionOutputUpdate) => void | Promise<void>;
}
export interface FilesystemExecutionContext extends BaseExecutionContext {
  dataDir?: string;
  artifactDir?: string;
}
export interface ShellExecutionContext extends BaseExecutionContext {
  shellPath?: string;
  dataDir?: string;
  artifactDir?: string;
}
export interface PythonExecutionContext extends BaseExecutionContext {
  dataDir?: string;
  artifactDir?: string;
  pythonRuntime?: PythonRuntime;
  pythonPolicy?: { allowNetwork: boolean; allowFileWrite: boolean };
}
export interface WebExecutionContext extends BaseExecutionContext {
  dataDir?: string;
  artifactDir?: string;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  webFetchPolicy?: { allowPrivateNetwork?: boolean };
}
export interface VisionExecutionContext extends BaseExecutionContext {
  dataDir?: string;
  explainImage?: (
    request: ExplainImageRequest,
  ) => Promise<ExplainImageResponse>;
}
export interface IntegrationExecutionContext extends BaseExecutionContext {
  dataDir?: string;
  artifactDir?: string;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  getProviderConfig?: (provider: string) => Promise<unknown>;
}

/** Complete host context accepted by catalog dispatch. Executors use narrower contexts. */
export type ToolExecutionContext = FilesystemExecutionContext &
  ShellExecutionContext &
  PythonExecutionContext &
  WebExecutionContext &
  VisionExecutionContext &
  IntegrationExecutionContext;

// Result contracts live in `@nervekit/contracts` (single source of truth shared with the web UI).
export type ToolTextContent = ToolTextContentPayload;
export type ToolImageContent = ToolImageContentPayload;
export type ToolContentBlock = ToolContentBlockPayload;
export type ToolExecutionResult = ToolExecutionResultPayload;

export type ToolPathArgs = {
  path?: unknown;
};

export type ReadToolArgs = ToolPathArgs & {
  offset?: unknown;
  limit?: unknown;
  byteOffset?: unknown;
  byteLimit?: unknown;
};

export type WriteToolArgs = ToolPathArgs & {
  content?: unknown;
};

export type EditToolArgs = ToolPathArgs & {
  edits?: unknown;
};

export type BashToolArgs = {
  command?: unknown;
  cwd?: unknown;
  timeout?: unknown;
};

export type PythonToolArgs = {
  code?: unknown;
  path?: unknown;
  cwd?: unknown;
  timeout?: unknown;
  env?: unknown;
};

export type LsToolArgs = ToolPathArgs & {
  limit?: unknown;
};

export type FindToolArgs = ToolPathArgs & {
  pattern?: unknown;
  limit?: unknown;
};

export type GrepToolArgs = ToolPathArgs & {
  pattern?: unknown;
  glob?: unknown;
  ignoreCase?: unknown;
  literal?: unknown;
  context?: unknown;
  limit?: unknown;
};

export type WebSearchToolArgs = {
  query?: unknown;
  max_results?: unknown;
};

export type WebFetchToolArgs = {
  url?: unknown;
  raw?: unknown;
};

export type ExplainImageToolArgs = ToolPathArgs & {
  prompt?: unknown;
};

export type JiraToolArgs = Record<string, unknown>;
export type ConfluenceToolArgs = Record<string, unknown>;
