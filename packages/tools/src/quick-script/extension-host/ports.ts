import type {
  AccountInfo,
  ImageGenerateRequest,
  ImageGenerateResponse,
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
};
