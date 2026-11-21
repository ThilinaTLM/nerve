import type { AccountKind } from "@nervekit/contracts/extensions";
import type {
  AccountInfo,
  VisionExplainRequest,
  VisionResult,
} from "@nervekit/extension-api";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extension-api/host";

/** An `account` setting of an extension, as the selection of an account. */
export type AccountSelection = { extensionId: string; field: string };

/**
 * A request body as a credential provider may inspect it: digests the host computes (any size,
 * file-streamed bodies included) and, for bodies up to 20 MiB, the bytes. The stream never
 * reaches extension code.
 */
export type CredentialBody = {
  size: number | undefined;
  digest(algorithm: string): Promise<Uint8Array>;
  bytes(): Promise<Uint8Array>;
};

/** `unavailable`: the extension that defines the account's kind is gone or off. */
export type AccountCredentialState =
  | "ready"
  | "needs_sign_in"
  | "failed"
  | "unavailable";

export type CredentialApplication =
  | { ok: true; headers: Record<string, string>; query: Record<string, string> }
  | {
      ok: false;
      /** `unreachable`: the credential could not be refreshed for network reasons and is unchanged. */
      state: Exclude<AccountCredentialState, "ready"> | "unreachable";
      error?: string;
    };

/**
 * What the embedding host (the server) provides so the runtime can build an
 * extension's `ctx`. Data in, data out: the host resolves settings and
 * accounts; the runtime never reads configuration itself.
 */
export type ExtensionHostPorts = {
  /** Resolved values of the extension's settings (user → project → conversation), keyed by field. */
  settings(extensionId: string): Record<string, unknown>;
  accounts: {
    /**
     * An account by id. `selection` names the setting that selected it, so the host can apply the
     * level rule of the setting's scope (user scope selects user-level accounts only).
     */
    get(
      kind: string,
      id: string,
      selection?: AccountSelection,
    ): Promise<AccountInfo | undefined>;
    /** Whether the account's credential can be used. */
    state(kind: string, id: string): Promise<AccountCredentialState>;
    /** Why the account is not ready (for example the scopes it lacks), when known. */
    problem?(kind: string, id: string): Promise<string | undefined>;
    /**
     * The headers and query parameters the credential adds to one hop to an allowed credential
     * origin. Host-only: they go on the wire, never to extension code.
     */
    apply(
      kind: string,
      id: string,
      request: {
        method: string;
        url: URL;
        /** Headers the request carries so far (never the credential's own). */
        headers?: Record<string, string>;
        /** The body as the host can describe it; absent for a request without one. */
        body?: CredentialBody;
      },
    ): Promise<CredentialApplication>;
    /**
     * The service answered 401 to a credentialed request that began at `requestStartedAt` (epoch
     * ms): gets a newer credential so the request can be retried once. False: nothing to refresh.
     */
    refreshAfterRejection?(
      kind: string,
      id: string,
      requestStartedAt: number,
    ): Promise<boolean>;
    /** Marks the account used. */
    touch?(kind: string, id: string): void;
  };
  /**
   * The account definitions of a platform available to the call (built-in, user, and the open
   * project's own), whichever extension defines them. A using extension's selection is limited
   * to those covering its `uses` entry (`kindsForUse`). Absent: only its own definitions.
   */
  platformKinds?(platform: string): readonly AccountKind[];
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
