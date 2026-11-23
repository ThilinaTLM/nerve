import { readonly, writable, type Readable } from "svelte/store";
import {
  applyTheme,
  BridgeError,
  createBridgeClient,
  frameErrors,
  windowTransport,
  type BridgeClient,
} from "./client.js";
import type {
  BridgeJson,
  ClipboardImageType,
  ConfirmOptions,
  StoreChange,
  FileChange,
  FileChunk,
  FileInfo,
  FrameInit,
  MenuItem,
  Mode,
  NotifyLevel,
  ProjectInfo,
  ThemeChange,
  ThemeKind,
} from "./bridge-types.js";

let client: BridgeClient | undefined;
let detach: (() => void) | undefined;

const modeStore = writable<Mode>("preview");
const themeKindStore = writable<ThemeKind>("dark");

/** Where `@nervekit/extension-sdk/testing` puts its fake host; shared across copies of this module. */
const testClientKey = Symbol.for("nerve.extension-sdk.bridge");
let viaTestClient = false;

function current(): BridgeClient {
  const injected = (globalThis as Record<symbol, BridgeClient | undefined>)[
    testClientKey
  ];
  if (injected) {
    if (client !== injected) attach(injected);
    viaTestClient = true;
    return injected;
  }
  if (viaTestClient) {
    detach?.();
    client = undefined;
    viaTestClient = false;
  }
  client ??= attach(createBridgeClient(windowTransport()));
  return client;
}

// The stores start the connection on first use, so a component that reads only `$mode` (`host.mode`) works.
const lazy = <T>(store: Readable<T>): Readable<T> => ({
  subscribe(run, invalidate) {
    current();
    return store.subscribe(run, invalidate);
  },
});

/**
 * Makes `next` the client `host` talks to: it applies the theme when the host's `init` arrives and
 * keeps `host.mode` and `host.theme.kind` current. `startFrame` does this for real frames; tests pass a
 * client built on a fake transport (see `@nervekit/extension-sdk/testing`).
 */
export function attach(next: BridgeClient): BridgeClient {
  detach?.();
  client = next;
  const stops = [
    next.on("theme.changed", (change) => {
      themeKindStore.set(change.kind);
      applyTheme(document.documentElement, change.kind, change.tokensCss);
    }),
    next.on("mode.changed", (change) => modeStore.set(change.mode)),
  ];
  detach = () => stops.forEach((stop) => stop());
  void next.ready.then(
    (value) => {
      if (client !== next) return;
      modeStore.set(value.mode);
      themeKindStore.set(value.themeKind);
      applyTheme(document.documentElement, value.themeKind, value.tokensCss);
    },
    () => undefined,
  );
  return next;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Reads the whole file in chunks. */
async function readAll(): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const chunk = await current().request("file.read", { offset });
    const bytes = base64Decode(chunk.dataBase64);
    parts.push(bytes);
    total += bytes.length;
    offset += bytes.length;
    if (chunk.eof || bytes.length === 0) break;
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

const request = <M extends Parameters<BridgeClient["request"]>[0]>(
  method: M,
  params: Parameters<BridgeClient["request"]>[1] = {},
) => current().request(method, params as never);

/**
 * The frame's handle on the host; the one object a Svelte frame uses to talk to Nerve, grouped by
 * what it touches: `backend`, `pages`, `workspace`, `project`, `theme`, `mode`, `file`, `store`,
 * `tabState`, `chat`, `clipboard`, `settings` and `ui`. Every method is a bridge request: JSON in,
 * JSON out, each answered exactly once. The host checks it against the contribution that owns the
 * frame, so `file.*` exists only in previews and `file.write` only in previews with
 * `edit: "custom"` (else `BridgeError` `not_allowed`). A frame has no network: fetch remote data
 * through a backend method with `host.backend.call`.
 *
 * Failures reject with `BridgeError` (its `code`: see `BridgeErrorCode`). Every size is limited by
 * the host (`too_large` or `invalid_request` when exceeded); each method below names its limit.
 * Bytes travel as base64, so prefer text methods and range reads. Nothing here throws before the
 * handshake: `startFrame` mounts the UI after it, and `host.ready` resolves with the init
 * (extension id, contribution, page params) for code that needs them. Uncaught errors, unhandled
 * rejections and CSP violations in the frame are reported to the host automatically and appear in
 * `extensions.status().recentErrors`.
 */
export const host = {
  /** Resolves with the host's init message when the handshake is done; rejects with `BridgeError` `failed` after about 10 s without an answer. `startFrame` awaits it before mounting and passes it to `render`. */
  get ready(): Promise<FrameInit> {
    return current().ready;
  },
  /** Calls the extension's own backend. */
  backend: {
    /**
     * Calls one of this extension's own backend methods (`<namespace>.<method>`, as declared in the
     * definition) and resolves with its result (`undefined` when it returns nothing). No permission
     * prompt applies, because the user's consent covers it, but the backend's `ctx` rules hold
     * (network allowlist, credentials stay host-side, file reads stay inside the project). `args`
     * (JSON, at most 1 MiB) arrives as the method's single argument, so its `parse` must accept it
     * (an object, or a bare string). The result must be JSON. Times out after 60 s. Rejects with
     * `BridgeError`: `not_found` (no such method), `backend_error` (the method threw; the message
     * is its shortened error), `too_large`.
     */
    call: async (
      method: string,
      args?: BridgeJson,
    ): Promise<BridgeJson | undefined> =>
      (
        await request(
          "backend.call",
          args === undefined ? { method } : { method, args },
        )
      ).value,
  },
  /** This extension's pages. */
  pages: {
    /** Opens one of this extension's pages by its manifest `id`; `params` (JSON, at most 4 KiB) reaches the page through `pages.params()`. Rejects `not_found` for an unknown page. */
    open: async (id: string, params?: BridgeJson): Promise<void> => {
      await request(
        "pages.open",
        params === undefined ? { id } : { id, params },
      );
    },
    /** Pages: the `params` the page was opened with (`host.pages.open(id, params)`); `undefined` when none or when this frame is not a page. */
    params: async (): Promise<BridgeJson | undefined> =>
      (await current().ready).pageParams,
  },
  /** The project's files and tabs. */
  workspace: {
    /** Opens a project file in a tab; `path` is relative to the project or absolute inside it. */
    openFile: async (path: string): Promise<void> => {
      await request("workspace.openFile", { path });
    },
  },
  /** The open project. */
  project: {
    /** Id, name and absolute directory of the project. */
    info: (): Promise<ProjectInfo> => request("project.info"),
  },
  /** The active colour theme; its tokens are applied to the frame already. */
  theme: {
    /** `light` or `dark`, following the active theme, as a Svelte store: `const { kind } = host.theme;` then `$kind` in a component. */
    kind: lazy(readonly(themeKindStore)) as Readable<ThemeKind>,
    /** Called when the active theme changes. Returns the unsubscribe function. */
    onChange: (handler: (change: ThemeChange) => void): (() => void) =>
      current().on("theme.changed", handler),
  },
  /** `edit` only in previews with `edit: "custom"` (the host switches between showing and editing); `preview` everywhere else. A Svelte store: `const { mode } = host;` then `$mode` in a component. */
  mode: lazy(readonly(modeStore)) as Readable<Mode>,
  /** The previewed file. Previews only (else `not_allowed`). */
  file: {
    /** Name, extension and size of the previewed file. */
    info: (): Promise<FileInfo> => request("file.info"),
    /**
     * One chunk of bytes: `offset` default 0, `length` default 262,144 (256 KiB) and at most
     * 1,048,576 (1 MiB). Use it to read large files on demand; `bytes()` and `text()` read the whole file.
     */
    read: (
      options: { offset?: number; length?: number } = {},
    ): Promise<FileChunk> => request("file.read", options),
    /** The whole file, read in chunks. */
    bytes: readAll,
    /** The whole file decoded as UTF-8. */
    text: async (): Promise<string> =>
      new TextDecoder().decode(await readAll()),
    /**
     * Previews with `edit: "custom"`: replaces the whole file (a string is written as UTF-8,
     * at most 5 MiB of content); the host owns saving and the dirty state. Resolves with the new size.
     */
    write: async (content: string | Uint8Array): Promise<{ size: number }> =>
      typeof content === "string"
        ? request("file.write", { content, encoding: "utf8" })
        : request("file.write", {
            content: base64Encode(content),
            encoding: "base64",
          }),
    /** The previewed file changed on disk. Returns the unsubscribe function. */
    onChange: (handler: (change: FileChange) => void): (() => void) =>
      current().on("file.changed", handler),
  },
  /**
   * Durable JSON storage for this extension in the open project, shared by all its frames and its
   * backend (`ctx.extensionStore`). Unlike `tabState` it is not tied to a tab, and unlike
   * `localStorage` (unavailable in frames) it survives reloads. Keys: letters, digits, `.`, `_`,
   * `-`, 1–128 characters, not starting with `.`. Each key has a `revision` (1 on first write, +1
   * on every write). Limits: 4 MiB per value, 1000 keys and 64 MiB per project (`too_large`).
   * Pass `ifRevision` to detect concurrent writes: a stale one rejects with `BridgeError`
   * `conflict`; re-read and retry.
   */
  store: {
    /** The value and revision of `key`; `undefined` when it does not exist. */
    get: async (
      key: string,
    ): Promise<{ value: BridgeJson; revision: number } | undefined> =>
      (await request("store.get", { key })).entry ?? undefined,
    /**
     * Writes `value` and resolves with the new revision. With `ifRevision`, writes only when the
     * stored revision equals it (`0`: only when the key does not exist), else rejects `conflict`.
     */
    set: async (
      key: string,
      value: BridgeJson,
      options: { ifRevision?: number } = {},
    ): Promise<{ revision: number }> =>
      request(
        "store.set",
        options.ifRevision === undefined
          ? { key, value }
          : { key, value, ifRevision: options.ifRevision },
      ),
    /** Deletes `key` (a missing key is fine). With `ifRevision`, rejects `conflict` when it does not match. */
    delete: async (
      key: string,
      options: { ifRevision?: number } = {},
    ): Promise<void> => {
      await request(
        "store.delete",
        options.ifRevision === undefined
          ? { key }
          : { key, ifRevision: options.ifRevision },
      );
    },
    /** Keys starting with `prefix` (all when omitted), each with its revision and serialized size in bytes. */
    keys: async (
      prefix?: string,
    ): Promise<{ key: string; revision: number; size: number }[]> =>
      (await request("store.keys", prefix === undefined ? {} : { prefix }))
        .keys,
    /** A key changed, from another frame of this extension or its backend; `revision` is `null` when deleted. Not sent for this frame's own writes. Returns the unsubscribe function. */
    onChange: (handler: (change: StoreChange) => void): (() => void) =>
      current().on("store.changed", handler),
  },
  /**
   * State kept with the tab. A frame must save what it needs to restore, because hidden tabs and
   * panels unload their frame.
   */
  tabState: {
    /** State saved with `set`, kept with the tab (`null` when none). */
    get: async (): Promise<BridgeJson | null> =>
      (await request("tabState.get")).state,
    /** Saves JSON state with the tab; at most 64 KiB serialized (else `invalid_request`). */
    set: async (state: BridgeJson): Promise<void> => {
      await request("tabState.set", { state });
    },
  },
  /** The chat: its composer and new conversations. */
  chat: {
    /** Appends text (1–20,000 characters) to the chat composer. */
    insert: async (text: string): Promise<void> => {
      await request("chat.insert", { text });
    },
    /**
     * Starts a conversation in the open project and resolves with its id (Nerve does not track
     * it afterwards). Call it from a click or key handler (else `not_allowed`) and declare
     * `"chat.startConversation"` in `permissions.frame` (else `not_allowed`). `title`: absent
     * keeps Nerve's normal title behaviour. `model`, `agentProfile` and `permissionRuleSet` are
     * keys of this extension's settings of type `model`, `agentProfile` and `permissionRuleSet`
     * (another key or type rejects `invalid_request`); an unset setting means Nerve's default.
     * `send` (default `true`): `false` leaves the prompt unsent in that conversation's composer.
     * `open` (default `true`): opens the conversation in the app.
     */
    startConversation: (options: {
      prompt: string;
      title?: string;
      model?: string;
      agentProfile?: string;
      permissionRuleSet?: string;
      send?: boolean;
      open?: boolean;
    }): Promise<{ conversationId: string }> =>
      request("chat.startConversation", options),
  },
  /**
   * Writes to the system clipboard (reading is not possible). A frame may not use
   * `navigator.clipboard`; call these from a click or key handler, because the host refuses
   * (`not_allowed`) without a recent user gesture in the frame.
   */
  clipboard: {
    /** Copies text (at most 1 MiB UTF-8). */
    writeText: async (text: string): Promise<void> => {
      await request("clipboard.writeText", { text });
    },
    /**
     * Copies an image (at most 5 MiB). `mediaType` defaults to the blob's type, else `image/png`;
     * it must be `image/png`, `image/jpeg` or `image/webp` (the host converts to PNG).
     */
    writeImage: async (
      image: Blob | Uint8Array,
      mediaType?: ClipboardImageType,
    ): Promise<void> => {
      const bytes =
        image instanceof Uint8Array
          ? image
          : new Uint8Array(await image.arrayBuffer());
      const type =
        mediaType ?? (image instanceof Uint8Array ? undefined : image.type);
      await request("clipboard.writeImage", {
        dataBase64: base64Encode(bytes),
        mediaType: (type || "image/png") as ClipboardImageType,
      });
    },
  },
  /** The extension's settings. */
  settings: {
    /** The resolved, non-secret value of the setting `key` (secrets are never included); `undefined` when it is unset or not a field of this extension. Cast with `T`. */
    get: async <T extends BridgeJson = BridgeJson>(
      key: string,
    ): Promise<T | undefined> =>
      (await request("settings.get", { key })).value as T | undefined,
  },
  /** Host-drawn UI. A frame cannot draw outside its rectangle, so dialogs, menus and toasts go through the host. */
  ui: {
    /** Asks in the host's dialog; frames cannot render dialogs of their own. Resolves `true` when confirmed, `false` when cancelled. */
    confirm: async (options: ConfirmOptions): Promise<boolean> =>
      (await request("ui.confirm", options)).confirmed,
    /**
     * Shows a menu drawn by the host (1–32 items); resolves with the chosen item's id, or `null`
     * when dismissed. `position` is frame-relative CSS pixels (the host clamps it to the frame);
     * absent: where the host decides.
     */
    showMenu: async (
      items: MenuItem[],
      position?: { x: number; y: number },
    ): Promise<string | null> =>
      (await request("ui.showMenu", position ? { items, position } : { items }))
        .id,
    /** A toast drawn by the host (1–20,000 characters); `level` default `info`. */
    notify: async (message: string, level?: NotifyLevel): Promise<void> => {
      await request("ui.notify", level ? { message, level } : { message });
    },
  },
};

/** The type of `host`. */
export type Host = typeof host;

function linkBaseCss(url: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    const done = () => resolve();
    link.onload = done;
    link.onerror = done;
    setTimeout(done, 3000);
    document.head.append(link);
  });
}

/**
 * Starts a frame: handshake, theme and base CSS, then `render(target, init)` with the host's init
 * (extension id, contribution, page params). A thrown error is shown
 * in the frame (the host cannot see inside it) and rethrown. `nerve-ext build` generates the
 * frame's entry that calls it, so a Svelte component does not call it itself.
 */
export async function startFrame(options: {
  /** Element the frame renders into. */
  target: HTMLElement;
  /** Mounts the UI into `target` after the handshake, with the init the host sent; may return a cleanup function. */
  render: (target: HTMLElement, init: FrameInit) => void | (() => void);
}): Promise<void> {
  try {
    const bridge = current();
    const value = await bridge.ready;
    await linkBaseCss(value.baseCssUrl);
    options.render(options.target, value);
  } catch (cause) {
    const message =
      cause instanceof BridgeError || cause instanceof Error
        ? cause.message
        : String(cause);
    options.target.textContent = `This extension view failed to start: ${message}`;
    frameErrors?.report({
      kind: "error",
      message: `The view failed to start: ${message}`,
    });
    throw cause;
  }
}
