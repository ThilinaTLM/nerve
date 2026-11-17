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
  FileChange,
  FrameInit,
  Mode,
  MethodName,
  ThemeChange,
  ThemeKind,
} from "./bridge-types.js";

/** A failed bridge request: the host's `code` and message, or `failed` when it could not be sent. */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** How a client talks to its host: `window.parent` in a frame, a fake in tests. */
export type BridgeTransport = {
  post(message: unknown): void;
  /** Calls `handler` for every message from the host; returns the unsubscribe function. */
  listen(handler: (data: unknown) => void): () => void;
};

type Listeners = {
  themeChanged: ((change: ThemeChange) => void)[];
  fileChanged: ((change: FileChange) => void)[];
  modeChanged: ((change: { mode: Mode }) => void)[];
};

export type BridgeClient = {
  /** Resolves with the host's `init` (also applied: see `applyTheme`). */
  readonly ready: Promise<
    FrameInit & { baseCssUrl: string; tokensCss: string }
  >;
  request<M extends MethodName>(
    method: M,
    params: BridgeMethods[M]["params"],
  ): Promise<BridgeMethods[M]["result"]>;
  on<E extends keyof Listeners>(
    event: E,
    handler: Listeners[E][number],
  ): () => void;
  /** Stops listening; pending requests fail. */
  close(): void;
};

const readyRetryMs = 500;
const readyAttempts = 20;

/** Starts the handshake (`ready`, then waits for `init`) and returns the client. */
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
