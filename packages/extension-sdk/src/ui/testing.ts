import {
  bridgeFrameErrorMessageSchema,
  bridgeProtocolVersion,
  bridgeRequestSchema,
  validateBridgeRequest,
} from "@nervekit/contracts/extensions";
import {
  createBridgeClient,
  startFrameErrorReporting,
  type BridgeClient,
  type BridgeTransport,
} from "./client.js";
import type {
  BridgeJson,
  ConfirmOptions,
  ContributionKind,
  MenuItem,
  Mode,
  NotifyLevel,
  PreviewEdit,
  ThemeKind,
} from "./bridge-types.js";

/** Same key the bridge client reads (`host.ts`): the fake host is found through `globalThis`. */
const testClientKey = Symbol.for("nerve.extension-sdk.bridge");

const defaultTokensCss =
  "--background:#101114;--foreground:#e8e8ea;--primary:#7aa2f7;";

/** What the fake host answers with; every member is optional. */
export type FakeBridgeOptions = {
  /** Kind of the frame under test; default `"preview"`. A kind may call only its bridge methods (`file.*` is previews only). */
  kind?: ContributionKind;
  /** The contribution id; default `"test"`. */
  id?: string;
  /** `host.extensionId`; default `"test-extension"`. */
  extensionId?: string;
  /** Previews only; default `"source"`. `file.write` and `mode.get` need `"custom"`. */
  edit?: PreviewEdit;
  /** Initial mode; default `"preview"`. */
  mode?: Mode;
  /** Initial theme kind; default `"dark"`. */
  themeKind?: ThemeKind;
  /** Initial theme tokens (`--name:value;` declarations); default: a few dark colours. */
  tokensCss?: string;
  /** `host.pageParams` of a page. */
  pageParams?: BridgeJson;
  /** Previews: the previewed file. */
  file?: {
    /** Project-relative path; default `"sample.txt"`. */
    path?: string;
    /** Initial content. */
    content: string | Uint8Array;
    /** ISO timestamp for `file.info`. */
    modifiedAt?: string;
  };
  /** Answer of `host.settings.get()`; default `{}`. */
  settings?: Record<string, BridgeJson>;
  /** Initial `host.viewState` value; default `null`. */
  viewState?: BridgeJson | null;
  /** Answer of `host.project.info()`; defaults `project-1`, `project` and `/project`. */
  project?: {
    /** Default `"project-1"`. */
    id?: string;
    /** Default `"project"`. */
    name?: string;
    /** Default `"/project"`. */
    directory?: string;
  };
  /** Whether the frame has a recent user gesture; default `true`. `false`: `host.clipboard.*` rejects `not_allowed`, as the host does outside a click. */
  userActivation?: boolean;
  /** Initial content of `host.extensionStore`, by key (each starts at revision 1). */
  store?: Record<string, BridgeJson>;
  /** Answers `host.call(method, args)`; default: `backend_error` (no backend). */
  call?: (
    method: string,
    args: BridgeJson | undefined,
  ) => BridgeJson | undefined | Promise<BridgeJson | undefined>;
  /** Answer of `host.ui.confirm`; default `true`. */
  confirm?: boolean | ((options: ConfirmOptions) => boolean);
  /** Answer of `host.ui.showMenu`: the chosen id; default: the first enabled item. */
  menu?: string | null | ((items: MenuItem[]) => string | null);
};

/** The fake host a test inspects and drives. */
export type FakeBridge = {
  /** Every request the frame sent, in order, after the real host-side validation. */
  requests: {
    /** Bridge method name (`file.read`, `call`, …). */
    method: string;
    /** The validated params. */
    params: unknown;
  }[];
  /** Bytes of the previewed file; `file.write` replaces them. */
  readonly fileBytes: Uint8Array;
  /** Text of the previewed file as UTF-8. */
  readonly fileText: string;
  /** Toasts of `host.ui.notify`, with the level defaulted to `info`. */
  notifications: {
    /** Toast text. */
    message: string;
    /** Toast level; `info` when the frame gave none. */
    level: NotifyLevel;
  }[];
  /** Files and pages the frame asked the host to open (`host.openFile`, `host.openPage`). */
  opened: {
    /** Paths passed to `host.openFile`. */
    files: string[];
    /** Calls of `host.openPage`. */
    pages: {
      /** Page id. */
      id: string;
      /** The page `params`, when given. */
      params?: BridgeJson;
    }[];
  };
  /** Texts the frame appended to the composer (`host.composer.insert`). */
  composerText: string[];
  /** Current `viewState`; the frame's `viewState.set` writes it. */
  viewState: BridgeJson | null;
  /** What the frame copied with `host.clipboard`, in order: `text` for `writeText`, `image` (decoded bytes and media type) for `writeImage`. Refused writes are not recorded. */
  clipboard: {
    /** Set by `writeText`. */
    text?: string;
    /** Set by `writeImage`. */
    image?: {
      /** Decoded image bytes. */
      bytes: Uint8Array;
      /** Media type the frame passed (`image/png`, `image/jpeg` or `image/webp`). */
      mediaType: string;
    };
  }[];
  /** The frame's `host.extensionStore` contents: value and revision by key. Writes through the host follow its rules (`conflict` on a stale `ifRevision`). */
  store: Map<
    string,
    {
      /** The stored JSON value. */
      value: BridgeJson;
      /** 1 on first write, +1 on every write. */
      revision: number;
    }
  >;
  /** Failures the frame reported to the host (`frameError`): uncaught errors, unhandled rejections and CSP violations. */
  frameErrors: {
    /** `error`, `unhandledrejection` or `csp`. */
    kind: string;
    /** Error message. */
    message: string;
    /** Script location or blocked URL, when known. */
    source?: string;
  }[];
  /** Resolves when the handshake is done; `await host.ready` to also have the theme applied. */
  ready: Promise<void>;
  /** Sends a `themeChanged` event; `host.onThemeChange` handlers run. */
  emitThemeChanged(kind: ThemeKind, tokensCss: string): void;
  /** Sends a `modeChanged` event; the `mode` store and `host.onModeChange` handlers update. */
  emitModeChanged(mode: Mode): void;
  /** Sends a `fileChanged` event; `content`, when given, replaces the file's bytes first. */
  emitFileChanged(
    change: { size: number; modifiedAt?: string },
    content?: string | Uint8Array,
  ): void;
  /** Sends an `extensionStoreChanged` event, as if another frame or the backend changed `key` (`revision` `null`: deleted); `host.onExtensionStoreChange` handlers run. It does not change `store`. */
  emitExtensionStoreChanged(key: string, revision: number | null): void;
  /** Disconnects the frame's `host` from this fake. Call it in `afterEach`. */
  close(): void;
};

/** The params of every method, merged: each case reads the fields its method has (checked by the contract). */
type FakeParams = {
  offset?: number;
  length?: number;
  content: string;
  encoding: "utf8" | "base64";
  method: string;
  args?: BridgeJson;
  state: BridgeJson;
  message: string;
  level?: NotifyLevel;
  path: string;
  id: string;
  params?: BridgeJson;
  text: string;
  items: MenuItem[];
  dataBase64: string;
  mediaType: string;
  key: string;
  value: BridgeJson;
  ifRevision?: number;
  prefix?: string;
};

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string"
    ? new TextEncoder().encode(content)
    : content;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Plays the host for Vitest component and logic tests: the frame's `host` talks to it instead of
 * `window.parent`. It runs the real handshake and checks every request with the same
 * contract the app uses (`validateBridgeRequest`: unknown methods, wrong kind, a preview without
 * `edit: "custom"` calling `file.write` all fail like in Nerve), then answers from `options`.
 */
export function createFakeBridge(options: FakeBridgeOptions = {}): FakeBridge {
  const kind = options.kind ?? "preview";
  const contribution = {
    kind,
    id: options.id ?? "test",
    ...(kind === "preview" ? { edit: options.edit ?? "source" } : {}),
  };
  const fakeEdit = kind === "preview" ? (options.edit ?? "source") : undefined;
  let currentMode: Mode = options.mode ?? "preview";
  let theme: { kind: ThemeKind; tokensCss: string } = {
    kind: options.themeKind ?? "dark",
    tokensCss: options.tokensCss ?? defaultTokensCss,
  };
  let bytes = toBytes(options.file?.content ?? "");
  let modifiedAt = options.file?.modifiedAt;
  const path = options.file?.path ?? "sample.txt";

  const bridge: FakeBridge = {
    requests: [],
    get fileBytes() {
      return bytes;
    },
    get fileText() {
      return new TextDecoder().decode(bytes);
    },
    notifications: [],
    opened: { files: [], pages: [] },
    composerText: [],
    clipboard: [],
    store: new Map(
      Object.entries(options.store ?? {}).map(([key, value]) => [
        key,
        { value, revision: 1 },
      ]),
    ),
    frameErrors: [],
    viewState: options.viewState ?? null,
    ready: undefined as never,
    emitThemeChanged(kindValue, tokensCss) {
      theme = { kind: kindValue, tokensCss };
      send({ type: "event", event: "themeChanged", data: theme });
    },
    emitModeChanged(next) {
      currentMode = next;
      send({ type: "event", event: "modeChanged", data: { mode: next } });
    },
    emitFileChanged(change, content) {
      if (content !== undefined) bytes = toBytes(content);
      if (change.modifiedAt) modifiedAt = change.modifiedAt;
      send({ type: "event", event: "fileChanged", data: change });
    },
    emitExtensionStoreChanged(key, revision) {
      send({
        type: "event",
        event: "extensionStoreChanged",
        data: { key, revision },
      });
    },
    close() {
      stopErrors?.();
      client.close();
      if ((globalThis as Record<symbol, unknown>)[testClientKey] === client)
        delete (globalThis as Record<symbol, unknown>)[testClientKey];
    },
  };

  let deliver: ((data: unknown) => void) | undefined;
  const send = (message: Record<string, unknown>) =>
    queueMicrotask(() =>
      deliver?.({ nerveBridge: bridgeProtocolVersion, ...message }),
    );
  const fail = (id: string, code: string, message: string) =>
    send({ type: "response", id, ok: false, error: { code, message } });

  const answer = async (id: string, method: string, params: FakeParams) => {
    const reply = (result: unknown) =>
      send({ type: "response", id, ok: true, result });
    const chunks = (offset: number, length: number) => {
      const slice = bytes.subarray(offset, offset + length);
      return {
        offset,
        dataBase64: base64(slice),
        length: slice.length,
        size: bytes.length,
        eof: offset + slice.length >= bytes.length,
      };
    };
    switch (method) {
      case "file.info": {
        const name = path.split("/").pop() ?? path;
        const dot = name.lastIndexOf(".");
        return reply({
          path,
          name,
          extension: dot > 0 ? name.slice(dot).toLowerCase() : "",
          size: bytes.length,
          ...(modifiedAt ? { modifiedAt } : {}),
        });
      }
      case "file.read":
        return reply(
          chunks(params["offset"] ?? 0, params["length"] ?? 256 * 1024),
        );
      case "file.write":
        bytes =
          params["encoding"] === "base64"
            ? unbase64(params["content"])
            : toBytes(params["content"]);
        return reply({ size: bytes.length });
      case "mode.get":
        return reply({ mode: currentMode });
      case "call":
        if (!options.call)
          return fail(
            id,
            "backend_error",
            "The fake bridge has no `call` handler; pass `call` to createFakeBridge.",
          );
        try {
          const value = await options.call(params["method"], params["args"]);
          return reply(value === undefined ? {} : { value });
        } catch (cause) {
          return fail(
            id,
            "backend_error",
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      case "settings.get":
        return reply({ values: options.settings ?? {} });
      case "viewState.get":
        return reply({ state: bridge.viewState });
      case "viewState.set":
        bridge.viewState = params["state"];
        return reply({});
      case "ui.confirm": {
        const choice = options.confirm ?? true;
        return reply({
          confirmed:
            typeof choice === "function"
              ? choice(params as unknown as ConfirmOptions)
              : choice,
        });
      }
      case "ui.showMenu": {
        const items = params["items"] as MenuItem[];
        const choice = options.menu;
        return reply({
          id:
            typeof choice === "function"
              ? choice(items)
              : choice !== undefined
                ? choice
                : (items.find((item) => !item.disabled)?.id ?? null),
        });
      }
      case "ui.notify":
        bridge.notifications.push({
          message: params["message"],
          level: params["level"] ?? "info",
        });
        return reply({});
      case "openFile":
        bridge.opened.files.push(params["path"]);
        return reply({});
      case "openPage":
        bridge.opened.pages.push({
          id: params["id"],
          ...(params["params"] === undefined
            ? {}
            : { params: params["params"] }),
        });
        return reply({});
      case "project.info":
        return reply({
          id: options.project?.id ?? "project-1",
          name: options.project?.name ?? "project",
          directory: options.project?.directory ?? "/project",
        });
      case "clipboard.writeText":
      case "clipboard.writeImage": {
        if (options.userActivation === false)
          return fail(
            id,
            "not_allowed",
            "The clipboard can be written only right after a user gesture (a click or key press) in the frame.",
          );
        bridge.clipboard.push(
          method === "clipboard.writeText"
            ? { text: params["text"] }
            : {
                image: {
                  bytes: unbase64(params["dataBase64"]),
                  mediaType: params["mediaType"],
                },
              },
        );
        return reply({});
      }
      case "extensionStore.get": {
        const entry = bridge.store.get(params["key"]);
        return reply({
          value: entry?.value ?? null,
          revision: entry?.revision ?? null,
        });
      }
      case "extensionStore.set":
      case "extensionStore.delete": {
        const entry = bridge.store.get(params["key"]);
        if (
          params["ifRevision"] !== undefined &&
          params["ifRevision"] !== (entry?.revision ?? 0)
        )
          return fail(
            id,
            "conflict",
            `'${params["key"]}' is at revision ${entry?.revision ?? 0}, not ${params["ifRevision"]}.`,
          );
        if (method === "extensionStore.delete") {
          bridge.store.delete(params["key"]);
          return reply({});
        }
        const revision = (entry?.revision ?? 0) + 1;
        bridge.store.set(params["key"], { value: params["value"], revision });
        return reply({ revision });
      }
      case "extensionStore.keys":
        return reply({
          keys: [...bridge.store]
            .filter(([key]) => key.startsWith(params["prefix"] ?? ""))
            .map(([key, entry]) => ({
              key,
              revision: entry.revision,
              size: new TextEncoder().encode(JSON.stringify(entry.value))
                .length,
            })),
        });
      case "composer.insert":
        bridge.composerText.push(params["text"]);
        return reply({});
      default:
        return fail(id, "unknown_method", `Unknown method ${method}`);
    }
  };

  const transport: BridgeTransport = {
    listen(handler) {
      deliver = handler;
      return () => {
        deliver = undefined;
      };
    },
    post(message) {
      const request = bridgeRequestSchema.safeParse(message);
      if (!request.success) {
        // Besides requests, a frame sends `ready` and `frameError`.
        const error = bridgeFrameErrorMessageSchema.safeParse(message);
        if (error.success) bridge.frameErrors.push(error.data.error);
        else if ((message as { type?: unknown }).type === "ready")
          send({
            type: "init",
            contribution,
            extensionId: options.extensionId ?? "test-extension",
            mode: currentMode,
            themeKind: theme.kind,
            tokensCss: theme.tokensCss,
            baseCssUrl: "about:blank",
            ...(options.pageParams === undefined
              ? {}
              : { pageParams: options.pageParams }),
          });
        return;
      }
      const checked = validateBridgeRequest(request.data, {
        kind,
        ...(fakeEdit ? { edit: fakeEdit } : {}),
      });
      if (!checked.ok)
        return fail(request.data.id, checked.error.code, checked.error.message);
      bridge.requests.push({ method: checked.method, params: checked.params });
      void answer(
        request.data.id,
        checked.method,
        checked.params as FakeParams,
      );
    },
  };

  const client: BridgeClient = createBridgeClient(transport);
  // Like a real frame: window errors, unhandled rejections and CSP violations are reported.
  const stopErrors =
    typeof window === "undefined"
      ? undefined
      : startFrameErrorReporting(window, (message) => transport.post(message))
          .stop;
  (globalThis as Record<symbol, unknown>)[testClientKey] = client;
  bridge.ready = client.ready.then(() => undefined);
  return bridge;
}
