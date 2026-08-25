import type {
  ConversationLiveToolOutputStream,
  ToolContentBlockPayload,
  ToolExecutionResultPayload,
  ToolImageContentPayload,
  ToolTextContentPayload,
} from "@nervekit/contracts";
import type { PythonRuntime } from "./execution/python/runtime.js";

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

export type ToolExecutionContext = {
  cwd: string;
  signal?: AbortSignal;
  dataDir?: string;
  /** Host-owned durable directory for files produced by this tool call. */
  artifactDir?: string;
  shellPath?: string;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  getProviderConfig?: (provider: string) => Promise<unknown>;
  explainImage?: (
    request: ExplainImageRequest,
  ) => Promise<ExplainImageResponse>;
  pythonRuntime?: PythonRuntime;
  pythonPolicy?: {
    allowNetwork: boolean;
    allowFileWrite: boolean;
  };
  webFetchPolicy?: {
    /** Trusted host opt-in for deliberate localhost/LAN development access. */
    allowPrivateNetwork?: boolean;
  };
  onUpdate?: (update: ToolExecutionOutputUpdate) => void | Promise<void>;
};

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
  dryRun?: unknown;
  replacements?: unknown;
  insertions?: unknown;
  lineReplacements?: unknown;
  lineInsertions?: unknown;
  patch?: unknown;
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
