import type { OperationRisk } from "../policy/operation-request.js";
import type { ToolOutputStream } from "@nervekit/contracts/tools";
import type {
  ToolContentBlockPayload,
  ToolExecutionResultPayload,
  ToolImageContentPayload,
  ToolTextContentPayload,
} from "@nervekit/contracts/tools";
import type { PythonRuntime } from "./python/runtime.js";

export type ToolExecutionOutputUpdate = {
  kind: "output";
  stream: ToolOutputStream;
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
  artifactDir?: string;
}
export interface ShellExecutionContext extends BaseExecutionContext {
  shellPath?: string;
  artifactDir?: string;
}
export interface PythonExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  pythonRuntime?: PythonRuntime;
  pythonPolicy?: { allowNetwork: boolean; allowFileWrite: boolean };
}
export interface WebExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  webFetchPolicy?: { allowPrivateNetwork?: boolean };
}
export interface VisionExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  explainImage?: (
    request: ExplainImageRequest,
  ) => Promise<ExplainImageResponse>;
}
/** Whether a configured quick_script namespace can be used now; the same text reaches the agent and, later, the Extensions page. */
export type NamespaceAvailability =
  | { configured: boolean; available: true }
  | {
      configured: boolean;
      available: false;
      /** Why the namespace cannot be used. */
      reason: string;
      /** What the user must do. */
      fix: string;
    };

/** Availability by namespace id, computed by the host from settings. */
export type QuickScriptAvailability = Readonly<
  Record<string, NamespaceAvailability>
>;

export interface IntegrationExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  /** Absolute managed folder of the conversation; may not exist yet. */
  conversationDir?: string;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  /** quick_script: whether each extension namespace is usable now, with reason and fix; `sdk.list` and `sdk.describe` report it. Absent: every namespace counts as available. */
  namespaces?: QuickScriptAvailability;
  /**
   * quick_script: checks one brokered SDK call against the conversation's
   * permission policy. Resolves when allowed; rejects with the one-line reason
   * otherwise (`ToolExecutionError` code `NESTED_DENIED` or
   * `NESTED_APPROVAL_REQUIRED`).
   */
  authorizeNested?: (request: QuickScriptNestedRequest) => Promise<void>;
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
  projectEnvironment?: unknown;
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

/**
 * One SDK call to check: an operation (`jira.issues.create`) with its
 * normalized resource targets and risk, or, for `web.*` and `files.*`, the
 * remaining direct tool the call is authorized as.
 */
export type QuickScriptNestedRequest =
  | {
      operation: string;
      /** Normalized `<system>:<type>/<id>` values. */
      targets: string[];
      risk: OperationRisk;
    }
  | { toolName: string; args: Record<string, unknown> };
