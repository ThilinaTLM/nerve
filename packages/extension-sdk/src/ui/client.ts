import {
  bridgeEvents,
  bridgeInitSchema,
  bridgeLimits,
  bridgeMethods,
  bridgeProtocolVersion,
  bridgeResponseSchema,
} from "@nervekit/contracts/extensions";
import type {
  BridgeErrorCode,
  BridgeMethods,
  ExtensionStoreChange,
  FileChange,
  FrameInit,
  Mode,
  MethodName,
  ThemeChange,
  ThemeKind,
} from "./bridge-types.js";

/** A failed bridge request: the host's `code` and message, or `failed` when it could not be sent. Every rejected `host.*` call is one. */
export class BridgeError extends Error {
  /** Why it failed; see `BridgeErrorCode` for each value. */
  readonly code: BridgeErrorCode;
  /** `message` says what went wrong (the field, the limit). */
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** How a client talks to its host: `window.parent` in a frame, a fake in tests. */
export type BridgeTransport = {
  /** Sends a message to the host. */
  post(message: unknown): void;
  /** Calls `handler` for every message from the host; returns the unsubscribe function. */
  listen(handler: (data: unknown) => void): () => void;
};

/** The events the host sends to a frame, with their handler types. */
type Listeners = {
  /** The active theme changed (all frames). */
  themeChanged: ((change: ThemeChange) => void)[];
  /** The previewed file changed on disk (previews). */
  fileChanged: ((change: FileChange) => void)[];
  /** The mode switched between `preview` and `edit` (previews with `edit: "custom"`). */
  modeChanged: ((change: { mode: Mode }) => void)[];
  /** A key of the extension's store changed (all kinds). */
  extensionStoreChanged: ((change: ExtensionStoreChange) => void)[];
};

/**
 * The protocol client behind `host`. Frames use `host`; build a client with `createBridgeClient`
 * only to test against a fake transport (`@nervekit/extension-sdk/testing` has `createFakeBridge`).
 */
export type BridgeClient = {
  /**
   * Resolves with the host's `init` message: `FrameInit` plus the URL of the base stylesheet and the
   * active theme's CSS custom properties. Rejects with `BridgeError` `failed` when the host does
   * not answer the `ready` message (sent every 500 ms, 20 times).
   */
  readonly ready: Promise<
    FrameInit & {
      /** URL of the base stylesheet (Tailwind preset, fonts) served with the frame. */
      baseCssUrl: string;
      /** Custom-property declarations (`--background:…;`) of the active theme. */
      tokensCss: string;
    }
  >;
  /**
   * Sends one bridge request. Params are validated before sending (`invalid_request`), and a
   * message over 8 MiB is refused (`too_large`). Rejects with `BridgeError`.
   */
  request<M extends MethodName>(
    method: M,
    params: BridgeMethods[M]["params"],
  ): Promise<BridgeMethods[M]["result"]>;
  /** Subscribes to a host event (`themeChanged`, `fileChanged`, `modeChanged`, `extensionStoreChanged`); returns the unsubscribe function. */
  on<E extends keyof Listeners>(
    event: E,
    handler: Listeners[E][number],
  ): () => void;
  /** Stops listening; pending requests fail. */
  close(): void;
};

const readyRetryMs = 500;
const readyAttempts = 20;

/** Starts the handshake (`ready`, then waits for `init`) and returns the client. Frames use `host`; this is for tests with a fake transport. */
export function createBridgeClient(transport: BridgeTransport): BridgeClient {
  let nextId = 0;
  const pending = new Map<
    string,
    {
      method: MethodName;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  const listeners: Listeners = {
    themeChanged: [],
    fileChanged: [],
    modeChanged: [],
    extensionStoreChanged: [],
  };
  let closed = false;
  let resolveReady!: (init: Awaited<BridgeClient["ready"]>) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<Awaited<BridgeClient["ready"]>>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  ready.catch(() => undefined);
  let initialised = false;

  const postReady = () =>
    transport.post({ nerveBridge: bridgeProtocolVersion, type: "ready" });

  const emit = <E extends keyof Listeners>(event: E, data: unknown) => {
    for (const handler of [...listeners[event]])
      (handler as (value: unknown) => void)(data);
  };

  const unlisten = transport.listen((data) => {
    if (closed || typeof data !== "object" || data === null) return;
    if (
      (data as { nerveBridge?: unknown }).nerveBridge !== bridgeProtocolVersion
    )
      return;
    const type = (data as { type?: unknown }).type;
    if (type === "init") {
      const parsed = bridgeInitSchema.safeParse(data);
      if (!parsed.success) {
        rejectReady(
          new BridgeError(
            "invalid_request",
            `The host sent an invalid init message: ${parsed.error.message}`,
          ),
        );
        return;
      }
      const init = {
        extensionId: parsed.data.extensionId,
        contribution: parsed.data.contribution,
        mode: parsed.data.mode,
        themeKind: parsed.data.themeKind,
        tokensCss: parsed.data.tokensCss,
        baseCssUrl: parsed.data.baseCssUrl,
        pageParams: parsed.data.pageParams,
      };
      if (initialised) {
        emit("modeChanged", { mode: init.mode });
        emit("themeChanged", {
          kind: init.themeKind,
          tokensCss: init.tokensCss,
        });
        return;
      }
      initialised = true;
      resolveReady(init as Awaited<BridgeClient["ready"]>);
    } else if (type === "response") {
      const parsed = bridgeResponseSchema.safeParse(data);
      if (!parsed.success) return;
      const entry = pending.get(parsed.data.id);
      if (!entry) return;
      pending.delete(parsed.data.id);
      if (!parsed.data.ok) {
        entry.reject(
          new BridgeError(parsed.data.error.code, parsed.data.error.message),
        );
        return;
      }
      const result = bridgeMethods[entry.method].result.safeParse(
        parsed.data.result,
      );
      if (result.success) entry.resolve(result.data);
      else
        entry.reject(
          new BridgeError(
            "failed",
            `The host answered ${entry.method} with an unexpected result: ${result.error.message}`,
          ),
        );
    } else if (type === "event") {
      const name = (data as { event?: unknown }).event;
      if (typeof name !== "string" || !Object.hasOwn(bridgeEvents, name))
        return;
      const eventName = name as keyof typeof bridgeEvents;
      const payload = bridgeEvents[eventName].safeParse(
        (data as { data?: unknown }).data,
      );
      if (payload.success) emit(eventName, payload.data);
    }
  });

  let attempts = 0;
  postReady();
  const retry = setInterval(() => {
    if (initialised || closed || ++attempts >= readyAttempts) {
      clearInterval(retry);
      if (!initialised && !closed)
        rejectReady(
          new BridgeError(
            "failed",
            "The host did not answer the frame's ready message.",
          ),
        );
      return;
    }
    postReady();
  }, readyRetryMs);

  return {
    ready,
    request(method, params) {
      if (closed)
        return Promise.reject(
          new BridgeError("failed", "The bridge is closed."),
        );
      const definition = Object.hasOwn(bridgeMethods, method)
        ? bridgeMethods[method]
        : undefined;
      if (!definition)
        return Promise.reject(
          new BridgeError("unknown_method", `Unknown method ${method}`),
        );
      const checked = definition.params.safeParse(params ?? {});
      if (!checked.success)
        return Promise.reject(
          new BridgeError(
            "invalid_request",
            `${method}: ${checked.error.issues
              .map(
                (issue) =>
                  `${issue.path.join(".") || "params"}: ${issue.message}`,
              )
              .join("; ")}`,
          ),
        );
      const id = `r${++nextId}`;
      const message = {
        nerveBridge: bridgeProtocolVersion,
        type: "request",
        id,
        method,
        params: checked.data,
      };
      if (JSON.stringify(message).length > bridgeLimits.maxMessageBytes)
        return Promise.reject(
          new BridgeError("too_large", `${method}: the request is too large.`),
        );
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve: resolve as never, reject });
        try {
          transport.post(message);
        } catch (cause) {
          pending.delete(id);
          reject(
            new BridgeError(
              "failed",
              cause instanceof Error ? cause.message : String(cause),
            ),
          );
        }
      });
    },
    on(event, handler) {
      (listeners[event] as unknown[]).push(handler);
      return () => {
        const list = listeners[event] as unknown[];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      };
    },
    close() {
      closed = true;
      clearInterval(retry);
      unlisten();
      for (const entry of pending.values())
        entry.reject(new BridgeError("failed", "The bridge is closed."));
      pending.clear();
    },
  };
}

/** The transport of a real frame: messages to and from the parent window. */
export function windowTransport(): BridgeTransport {
  return {
    post: (message) => window.parent.postMessage(message, "*"),
    listen(handler) {
      const listener = (event: MessageEvent) => {
        if (event.source === window.parent) handler(event.data);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}

/** Applies a theme: custom-property declarations (`--name:value;`) on the root, plus the colour mode. */
export function applyTheme(
  root: HTMLElement,
  kind: ThemeKind,
  tokensCss: string,
): void {
  // Through the style object, not a <style> element: the frame's CSP does not allow inline styles.
  for (const declaration of tokensCss.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim();
    if (name.startsWith("--"))
      root.style.setProperty(name, declaration.slice(colon + 1).trim());
  }
  root.dataset["colorMode"] = kind;
  root.style.colorScheme = kind;
}

// ── Frame error reporting ─────────────────────────────────────────────────

type FrameErrorKind = "error" | "unhandledrejection" | "csp";
type FrameErrorReport = {
  kind: FrameErrorKind;
  message: string;
  source?: string;
};

/** Shortens a URL to scheme, host and path (no query, no fragment); other values pass through trimmed. */
export function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "data:" || url.protocol === "blob:")
      return `${url.protocol}…`;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value.slice(0, 200);
  }
}

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * Reports the frame's own failures (uncaught errors, unhandled rejections, CSP violations) to the
 * host with `frameError` messages, which the host records for `extensions.status`. Identical
 * reports are sent once and at most `maxFrameErrorsPerLoad` per page load; nothing here throws.
 * Returns `report` (for failures the frame catches itself) and `stop`.
 */
export function startFrameErrorReporting(
  target: EventTarget,
  post: (message: unknown) => void,
): { report(error: FrameErrorReport): void; stop(): void } {
  const seen = new Set<string>();
  const report = (error: FrameErrorReport) => {
    try {
      const message = clip(error.message || "Unknown error", 1000);
      const source = error.source ? clip(error.source, 500) : undefined;
      const key = `${error.kind}\n${message}\n${source ?? ""}`;
      if (seen.has(key) || seen.size >= bridgeLimits.maxFrameErrorsPerLoad)
        return;
      seen.add(key);
      post({
        nerveBridge: bridgeProtocolVersion,
        type: "frameError",
        error: {
          kind: error.kind,
          message,
          ...(source ? { source } : {}),
        },
      });
    } catch {
      // Reporting must never break the frame.
    }
  };
  const onError = (event: ErrorEvent) => {
    try {
      const where = event.filename
        ? `${shortUrl(event.filename)}${event.lineno ? `:${event.lineno}` : ""}`
        : undefined;
      report({
        kind: "error",
        message:
          event.error instanceof Error ? event.error.message : event.message,
        ...(where ? { source: where } : {}),
      });
    } catch {
      // see report
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    try {
      const reason: unknown = event.reason;
      report({
        kind: "unhandledrejection",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } catch {
      // see report
    }
  };
  const onCsp = (event: SecurityPolicyViolationEvent) => {
    try {
      const blocked = event.blockedURI ? shortUrl(event.blockedURI) : "inline";
      const directive = event.violatedDirective || event.effectiveDirective;
      report({
        kind: "csp",
        message: `Blocked by ${directive}: ${blocked}`,
        ...(event.sourceFile
          ? { source: `${shortUrl(event.sourceFile)}:${event.lineNumber}` }
          : {}),
      });
    } catch {
      // see report
    }
  };
  target.addEventListener("error", onError as EventListener);
  target.addEventListener("unhandledrejection", onRejection as EventListener);
  target.addEventListener("securitypolicyviolation", onCsp as EventListener);
  return {
    report,
    stop() {
      target.removeEventListener("error", onError as EventListener);
      target.removeEventListener(
        "unhandledrejection",
        onRejection as EventListener,
      );
      target.removeEventListener(
        "securitypolicyviolation",
        onCsp as EventListener,
      );
    },
  };
}

/** The reporter of the real frame, installed when this module loads (before the handshake); `undefined` outside a frame. */
export const frameErrors =
  typeof window !== "undefined" && window.parent !== window
    ? startFrameErrorReporting(window, (message) =>
        window.parent.postMessage(message, "*"),
      )
    : undefined;
