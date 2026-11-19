import type {
  AccountInfo,
  ImageGenerateRequest,
  ImageGenerateResponse,
  VisionExplainRequest,
  VisionResult,
} from "@nervekit/extension-api";

/**
 * What the embedding host (the server) provides so the runtime can build an
 * extension's `ctx`. Data in, data out: the host resolves settings and
 * accounts; the runtime never reads configuration itself.
 */
export type ExtensionHostPorts = {
  /** Resolved values of the extension's settings (user → project → conversation), keyed by field. */
  settings(extensionId: string): Record<string, unknown>;
  accounts: {
    get(kind: string, id: string): Promise<AccountInfo | undefined>;
    /** The credential; used only to inject into `ctx.http` requests, never handed to extension code. */
    secret(kind: string, id: string): Promise<string | undefined>;
  };
  /** Extension diagnostics (`ctx.log`); dropped when absent. */
  log?: (
    level: "debug" | "warn",
    extensionId: string,
    message: string,
    data?: unknown,
  ) => void;
  /** The image generation backend behind `ctx.models.image`. */
  generateImage?: (
    request: ImageGenerateRequest,
  ) => Promise<ImageGenerateResponse>;
  /** The vision model behind `ctx.models.vision`, selected by the extension's `model` and `thinkingLevel` settings. */
  explainImage?: (request: VisionExplainRequest) => Promise<VisionResult>;
  /** The durable store of the open project; absent when the call has no project (`ctx.extensionStore` then rejects). */
  extensionStore?: ExtensionStorePort;
  /** Whether the extension's selected vision model resolves with credentials and accepts images. */
  visionReady?: (extensionId: string) => Promise<boolean>;
};

/** Why a store operation failed; the runtime maps it to an `ExtensionError`. */
export type ExtensionStoreErrorCode =
  | "conflict"
  | "too_large"
  | "invalid_request"
  | "not_found";

/**
 * The extension's durable store, bound by the host to one project. Operations reject with an
 * error whose `code` is an `ExtensionStoreErrorCode`.
 */
export type ExtensionStorePort = {
  get(
    extensionId: string,
    key: string,
  ): Promise<{ value: unknown; revision: number } | undefined>;
  set(
    extensionId: string,
    key: string,
    value: unknown,
    ifRevision?: number,
  ): Promise<{ revision: number }>;
  delete(extensionId: string, key: string, ifRevision?: number): Promise<void>;
  keys(
    extensionId: string,
    prefix?: string,
  ): Promise<{ key: string; revision: number; size: number }[]>;
};
