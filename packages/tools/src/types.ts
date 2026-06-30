import type {
  ToolContentBlockPayload,
  ToolExecutionResultPayload,
  ToolImageContentPayload,
  ToolTextContentPayload,
} from "@nervekit/shared";
import type { PythonRuntime } from "./execution/python/runtime.js";

export type ToolExecutionOutputUpdate = {
  kind: "output";
  stream: "stdout" | "stderr" | "combined";
  chunk: string;
};

export type ToolExecutionContext = {
  cwd: string;
  signal?: AbortSignal;
  dataDir?: string;
  shellPath?: string;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  getProviderConfig?: (provider: string) => Promise<unknown>;
  pythonRuntime?: PythonRuntime;
  pythonPolicy?: {
    allowNetwork: boolean;
    allowFileWrite: boolean;
  };
  onUpdate?: (update: ToolExecutionOutputUpdate) => void;
};

// Result contracts live in `@nervekit/shared` (single source of truth shared with the web UI).
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

export type JiraToolArgs = Record<string, unknown>;
