import type { ToolOutputStream } from "@nervekit/contracts/tools";
import type {
  ToolContentBlockPayload,
  ToolExecutionResultPayload,
  ToolImageContentPayload,
  ToolTextContentPayload,
} from "@nervekit/contracts/tools";
import type { PythonRuntime } from "./python/runtime.js";
import type { KrokiToolSettings } from "@nervekit/contracts/settings";
import type { QuickScriptAvailability } from "./quick-script/extensions/manifest-types.js";

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

export type ImageGenerateRequest = {
  prompt: string;
  signal?: AbortSignal;
};

export type ImageGenerateResponse = {
  provider: string;
  model: string;
  images: Array<{ data: Uint8Array; revisedPrompt?: string }>;
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
  getApiKey?: (provider: string) => Promise<string | undefined>;
  webFetchPolicy?: { allowPrivateNetwork?: boolean };
}
export interface VisionExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  explainImage?: (
    request: ExplainImageRequest,
  ) => Promise<ExplainImageResponse>;
}
export interface ImageGenerationExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  generateImage?: (
    request: ImageGenerateRequest,
  ) => Promise<ImageGenerateResponse>;
}
export interface KrokiExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  kroki?: KrokiToolSettings;
}
export interface IntegrationExecutionContext extends BaseExecutionContext {
  artifactDir?: string;
  /** Absolute managed folder of the conversation; may not exist yet. */
  conversationDir?: string;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  getProviderConfig?: (provider: string) => Promise<unknown>;
  /** quick_script `web.*`: `enabled` by Settings; `search` when a Tavily account with a token is selected (its key is `getApiKey("tavily")`). */
  web?: { enabled: boolean; search: boolean };
  /** quick_script: whether each extension namespace is usable now, with reason and fix; `sdk.list` and `sdk.describe` report it. Absent: every namespace counts as available. */
  namespaces?: QuickScriptAvailability;
  /**
   * quick_script: checks one brokered SDK call against the conversation's
   * permission policy as if it were a direct call to `toolName` with `args`.
   * Resolves when allowed; rejects with the one-line reason otherwise
   * (`ToolExecutionError` code `NESTED_DENIED` or `NESTED_APPROVAL_REQUIRED`).
   */
  authorizeNested?: (request: {
    toolName: string;
    args: Record<string, unknown>;
    /** Never allowed by a rule alone; needs a user-approved destructive script (raw non-GET requests). */
    approvalRequired?: boolean;
  }) => Promise<void>;
}

/** Complete host context accepted by catalog dispatch. Executors use narrower contexts. */
export type ToolExecutionContext = FilesystemExecutionContext &
  ShellExecutionContext &
  PythonExecutionContext &
  WebExecutionContext &
  VisionExecutionContext &
  ImageGenerationExecutionContext &
  KrokiExecutionContext &
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

export type JiraToolArgs = Record<string, unknown>;
export type ConfluenceToolArgs = Record<string, unknown>;
