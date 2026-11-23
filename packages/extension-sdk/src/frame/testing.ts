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
  AnchorRect,
  MenuEntry,
  PickRequest,
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
  /** Extension id in the init (`(await host.ready).extensionId`); default `"test-extension"`. */
  extensionId?: string;
  /** Previews only; default `"source"`. `file.write` needs `"custom"`. */
  edit?: PreviewEdit;
  /** Initial mode; default `"preview"`. */
  mode?: Mode;
  /** Initial theme kind; default `"dark"`. */
  themeKind?: ThemeKind;
  /** Initial theme tokens (`--name:value;` declarations); default: a few dark colours. */
  tokensCss?: string;
  /** What `host.pages.params()` resolves with on a page. */
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
  /** Values of `host.settings.get(key)` by key; a missing key resolves `undefined`. Default `{}`. */
  settings?: Record<string, BridgeJson>;
  /** Initial `host.tabState` value; default `null`. */
  tabState?: BridgeJson | null;
  /** Answer of `host.project.info()`; defaults `project-1`, `project` and `/project`. */
  project?: {
    /** Default `"project-1"`. */
    id?: string;
    /** Default `"project"`. */
    name?: string;
    /** Default `"/project"`. */
    directory?: string;
  };
  /** Whether the frame has a recent user gesture; default `true`. `false`: `host.clipboard.*`, `host.chat.startConversation`, `host.ui.confirm`, `host.ui.menu` and `host.ui.pick` reject `not_allowed`, as the host does outside a click. */
  userActivation?: boolean;
  /** Initial content of `host.store`, by key (each starts at revision 1). */
  store?: Record<string, BridgeJson>;
  /** Answers `host.backend.call(method, args)`; default: `backend_error` (no backend). */
  backend?: (
    method: string,
    args: BridgeJson | undefined,
  ) => BridgeJson | undefined | Promise<BridgeJson | undefined>;
  /** Answer of `host.ui.confirm`; default `true`. */
  confirm?: boolean | ((options: ConfirmOptions) => boolean);
  /** Answer of `host.ui.menu`: the chosen id or `null` (dismissed); a function gets the entries and the anchor. Default: the first enabled item, found in submenus too. */
  menu?:
    | string
    | null
    | ((entries: MenuEntry[], anchor: AnchorRect) => string | null);
  /** Answer of `host.ui.pick`: the chosen ids (one for `single`) or `null` (dismissed); a function gets the options with their `mode`. Default: `single` the first enabled item, `multiple` the items of `selected` (none when empty). */
  pick?: string[] | null | ((options: PickRequest) => string[] | null);
};

/** The fake host a test inspects and drives. */
export type FakeBridge = {
  /** Every request the frame sent, in order, after the real host-side validation. */
  requests: {
    /** Bridge method name (`file.read`, `backend.call`, …). */
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
  /** Files and pages the frame asked the host to open (`host.workspace.openFile`, `host.pages.open`). */
  opened: {
    /** Paths passed to `host.workspace.openFile`. */
    files: string[];
    /** Calls of `host.pages.open`. */
    pages: {
      /** Page id. */
      id: string;
      /** The page `params`, when given. */
      params?: BridgeJson;
    }[];
  };
  /** Texts the frame appended to the composer (`host.chat.insert`). */
  composerText: string[];
  /** Calls of `host.chat.startConversation` the fake accepted, in order, with the id it answered. Refused calls (no user gesture) are not recorded. */
  startedConversations: {
    /** The id the fake answered with (`conv_test_1`, `conv_test_2`, …). */
    conversationId: string;
    /** The options the frame passed (`prompt`, `title`, `send`, …). */
    options: Record<string, BridgeJson>;
  }[];
  /** Current `tabState`; the frame's `host.tabState.set` writes it. */
  tabState: BridgeJson | null;
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
  /** Calls of `host.ui.menu` the fake accepted, in order. Refused calls (no user gesture) are not recorded. */
  menus: {
    /** The entries the frame passed. */
    entries: MenuEntry[];
    /** The anchor as sent: an element is already measured. */
    anchor: AnchorRect;
    /** What the fake answered: the chosen id, or `null`. */
    chosen: string | null;
  }[];
  /** Calls of `host.ui.pick` the fake accepted, in order. Refused calls (no user gesture) are not recorded. */
  picks: {
    /** The options as sent, with `mode`; an element anchor is already measured. */
    options: PickRequest;
    /** What the fake answered: the chosen ids, or `null`. */
    chosen: string[] | null;
  }[];
  /** The frame's `host.store` contents: value and revision by key. Writes through the host follow its rules (`conflict` on a stale `ifRevision`). */
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
  /** Sends a `theme.changed` event; `host.theme.kind` and `host.theme.onChange` handlers update. */
  emitThemeChange(kind: ThemeKind, tokensCss: string): void;
  /** Sends a `mode.changed` event; the `host.mode` store updates. */
  emitModeChange(mode: Mode): void;
  /** Sends a `file.changed` event; `content`, when given, replaces the file's bytes first. */
  emitFileChange(
    change: { size: number; modifiedAt?: string },
    content?: string | Uint8Array,
  ): void;
  /** Sends a `store.changed` event, as if another frame or the backend changed `key` (`revision` `null`: deleted); `host.store.onChange` handlers run. It does not change `store`. */
  emitStoreChange(key: string, revision: number | null): void;
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
  entries: MenuEntry[];
  anchor: AnchorRect;
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

/** The id of the first enabled item of a menu, submenus included; `null` when there is none. */
function firstEnabledItem(entries: MenuEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type === "submenu") {
      if (entry.disabled) continue;
      const found = firstEnabledItem(entry.items);
      if (found !== null) return found;
    } else if (
      (entry.type === undefined || entry.type === "item") &&
      !entry.disabled
    )
      return entry.id;
  }
  return null;
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
    menus: [],
    picks: [],
    notifications: [],
    opened: { files: [], pages: [] },
    composerText: [],
    clipboard: [],
    startedConversations: [],
    store: new Map(
      Object.entries(options.store ?? {}).map(([key, value]) => [
        key,
        { value, revision: 1 },
      ]),
    ),
    frameErrors: [],
    tabState: options.tabState ?? null,
    ready: undefined as never,
    emitThemeChange(kindValue, tokensCss) {
      theme = { kind: kindValue, tokensCss };
      send({ type: "event", event: "theme.changed", data: theme });
    },
    emitModeChange(next) {
      currentMode = next;
      send({ type: "event", event: "mode.changed", data: { mode: next } });
    },
    emitFileChange(change, content) {
      if (content !== undefined) bytes = toBytes(content);
      if (change.modifiedAt) modifiedAt = change.modifiedAt;
      send({ type: "event", event: "file.changed", data: change });
    },
    emitStoreChange(key, revision) {
      send({
        type: "event",
        event: "store.changed",
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
    /** Host-drawn UI needs a user gesture, like the clipboard: answers `not_allowed` and returns `true` without one. */
    const refusedWithoutGesture = (requestId: string, what: string) => {
      if (options.userActivation !== false) return false;
      fail(
        requestId,
        "not_allowed",
        `A ${what} can be shown only right after a user gesture (a click or key press) in the frame.`,
      );
      return true;
    };
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
      case "backend.call":
        if (!options.backend)
          return fail(
            id,
            "backend_error",
            "The fake bridge has no backend; pass `backend` to createFakeBridge.",
          );
        try {
          const value = await options.backend(params["method"], params["args"]);
          return reply(value === undefined ? {} : { value });
        } catch (cause) {
          return fail(
            id,
            "backend_error",
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      case "settings.get":
        return reply(
          options.settings && Object.hasOwn(options.settings, params["key"])
            ? { value: options.settings[params["key"]] }
            : {},
        );
      case "tabState.get":
        return reply({ state: bridge.tabState });
      case "tabState.set":
        bridge.tabState = params["state"];
        return reply({});
      case "ui.confirm": {
        if (refusedWithoutGesture(id, "confirm")) return;
        const choice = options.confirm ?? true;
        return reply({
          confirmed:
            typeof choice === "function"
              ? choice(params as unknown as ConfirmOptions)
              : choice,
        });
      }
      case "ui.menu": {
        if (refusedWithoutGesture(id, "menu")) return;
        const entries = params["entries"];
        const choice = options.menu;
        const chosen =
          typeof choice === "function"
            ? choice(entries, params["anchor"])
            : choice !== undefined
              ? choice
              : firstEnabledItem(entries);
        bridge.menus.push({ entries, anchor: params["anchor"], chosen });
        return reply({ id: chosen });
      }
      case "ui.pick": {
        if (refusedWithoutGesture(id, "pick")) return;
        const pick = params as unknown as PickRequest;
        const choice = options.pick;
        const chosen =
          typeof choice === "function"
            ? choice(pick)
            : choice !== undefined
              ? choice
              : pick.mode === "single"
                ? [pick.items.find((item) => !item.disabled)?.id].filter(
                    (value): value is string => value !== undefined,
                  )
                : (pick.selected ?? []);
        bridge.picks.push({ options: pick, chosen });
        return reply({ ids: chosen });
      }
      case "ui.notify":
        bridge.notifications.push({
          message: params["message"],
          level: params["level"] ?? "info",
        });
        return reply({});
      case "workspace.openFile":
        bridge.opened.files.push(params["path"]);
        return reply({});
      case "pages.open":
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
      case "chat.startConversation": {
        if (options.userActivation === false)
          return fail(
            id,
            "not_allowed",
            "A conversation can be started only right after a user gesture (a click or key press) in the frame.",
          );
        const conversationId = `conv_test_${bridge.startedConversations.length + 1}`;
        bridge.startedConversations.push({
          conversationId,
          options: params as Record<string, BridgeJson>,
        });
        return reply({ conversationId });
      }
      case "store.get": {
        const entry = bridge.store.get(params["key"]);
        return reply({ entry: entry ?? null });
      }
      case "store.set":
      case "store.delete": {
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
        if (method === "store.delete") {
          bridge.store.delete(params["key"]);
          return reply({});
        }
        const revision = (entry?.revision ?? 0) + 1;
        bridge.store.set(params["key"], { value: params["value"], revision });
        return reply({ revision });
      }
      case "store.keys":
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
      case "chat.insert":
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
