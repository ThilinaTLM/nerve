import { readonly, writable, type Readable } from "svelte/store";
import {
  applyTheme,
  BridgeError,
  createBridgeClient,
  windowTransport,
  type BridgeClient,
} from "./client.js";
import type {
  BridgeJson,
  ConfirmOptions,
  FileChange,
  FileChunk,
  FileInfo,
  FrameInit,
  MenuItem,
  Mode,
  NotifyLevel,
  PreviewEdit,
  ProjectInfo,
  ThemeChange,
  ThemeKind,
  ContributionKind,
} from "./bridge-types.js";

type Ready = Awaited<BridgeClient["ready"]>;

let client: BridgeClient | undefined;
let init: Ready | undefined;
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
    init = undefined;
    viaTestClient = false;
  }
  client ??= attach(createBridgeClient(windowTransport()));
  return client;
}

// The stores start the connection on first use, so a component that reads only `$mode` works.
const lazy = <T>(store: Readable<T>): Readable<T> => ({
  subscribe(run, invalidate) {
    current();
    return store.subscribe(run, invalidate);
  },
});

/** The current mode of a preview (`edit` only in previews with `edit: "custom"`), as a Svelte store. */
export const mode: Readable<Mode> = lazy(readonly(modeStore));
/** `light` or `dark`, following the active theme, as a Svelte store. */
export const themeKind: Readable<ThemeKind> = lazy(readonly(themeKindStore));

/**
 * Makes `next` the client `host` talks to: it applies the theme when the host's `init` arrives and
 * keeps `mode` and `themeKind` current. `startFrame` does this for real frames; tests pass a
 * client built on a fake transport (see `@nervekit/extension-sdk/testing`).
 */
export function attach(next: BridgeClient): BridgeClient {
  detach?.();
  client = next;
  init = undefined;
  const stops = [
    next.on("themeChanged", (change) => {
      themeKindStore.set(change.kind);
      applyTheme(document.documentElement, change.kind, change.tokensCss);
    }),
    next.on("modeChanged", (change) => modeStore.set(change.mode)),
  ];
  detach = () => stops.forEach((stop) => stop());
  void next.ready.then(
    (value) => {
      if (client !== next) return;
      init = value;
      modeStore.set(value.mode);
      themeKindStore.set(value.themeKind);
      applyTheme(document.documentElement, value.themeKind, value.tokensCss);
    },
    () => undefined,
  );
  return next;
}

function started(): Ready {
  if (!init)
    throw new Error(
      "The host is not ready yet. Mount the UI through nerve-ext (it starts after the handshake), or await host.ready first.",
    );
  return init;
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
 * The frame's handle on the host. Every method is a bridge request; the host checks it against
 * the contribution that owns the frame, so `file.*` exists only in previews and `file.write`
 * and `mode.get` only in previews with `edit: "custom"`.
 */
export const host = {
  /** Resolves when the handshake is done. `startFrame` awaits it before mounting. */
  get ready(): Promise<FrameInit> {
    return current().ready;
  },
  get extensionId(): string {
    return started().extensionId;
  },
  get contribution(): {
    kind: ContributionKind;
    id: string;
    edit?: PreviewEdit;
  } {
    return started().contribution;
  },
  /** Pages: the `params` the page was opened with (`host.openPage(id, params)`). */
  get pageParams(): BridgeJson | undefined {
    return started().pageParams;
  },
  file: {
    /** Previews: name, extension and size of the previewed file. */
    info: (): Promise<FileInfo> => request("file.info"),
    /** One chunk of bytes; `file.bytes()` and `file.text()` read the whole file. */
    read: (
      options: { offset?: number; length?: number } = {},
    ): Promise<FileChunk> => request("file.read", options),
    bytes: readAll,
    text: async (): Promise<string> =>
      new TextDecoder().decode(await readAll()),
    /** Edit mode of previews with `edit: "custom"`: replaces the file's content. */
    write: async (content: string | Uint8Array): Promise<{ size: number }> =>
      typeof content === "string"
        ? request("file.write", { content, encoding: "utf8" })
        : request("file.write", {
            content: base64Encode(content),
            encoding: "base64",
          }),
  },
  mode: {
    /** Previews with `edit: "custom"`: the current mode. Prefer the `mode` store. */
    get: async (): Promise<Mode> => (await request("mode.get")).mode,
  },
  /** Calls one of this extension's backend methods (`namespace.method`); the host applies the backend's permissions. */
  call: async (
    method: string,
    args?: BridgeJson,
  ): Promise<BridgeJson | undefined> =>
    (await request("call", args === undefined ? { method } : { method, args }))
      .value,
  settings: {
    /** The extension's non-secret settings. */
    get: async (): Promise<Record<string, BridgeJson>> =>
      (await request("settings.get")).values,
  },
  viewState: {
    /** State saved with `set`, kept with the tab (`null` when none). */
    get: async (): Promise<BridgeJson | null> =>
      (await request("viewState.get")).state,
    set: async (state: BridgeJson): Promise<void> => {
      await request("viewState.set", { state });
    },
  },
  ui: {
    /** Asks in the host's dialog; frames cannot render dialogs of their own. */
    confirm: async (options: ConfirmOptions): Promise<boolean> =>
      (await request("ui.confirm", options)).confirmed,
    /** Shows a menu drawn by the host; resolves with the chosen item's id, or `null`. */
    showMenu: async (
      items: MenuItem[],
      position?: { x: number; y: number },
    ): Promise<string | null> =>
      (await request("ui.showMenu", position ? { items, position } : { items }))
        .id,
    /** A toast drawn by the host. */
    notify: async (message: string, level?: NotifyLevel): Promise<void> => {
      await request("ui.notify", level ? { message, level } : { message });
    },
  },
  /** Opens a project file in a tab. */
  openFile: async (path: string): Promise<void> => {
    await request("openFile", { path });
  },
  /** Opens one of this extension's pages. */
  openPage: async (id: string, params?: BridgeJson): Promise<void> => {
    await request("openPage", params === undefined ? { id } : { id, params });
  },
  project: {
    info: (): Promise<ProjectInfo> => request("project.info"),
  },
  composer: {
    /** Appends text to the chat composer. */
    insert: async (text: string): Promise<void> => {
      await request("composer.insert", { text });
    },
  },
  /** Called when the active theme changes; tokens are already applied. Returns the unsubscribe function. */
  onThemeChange: (handler: (change: ThemeChange) => void): (() => void) =>
    current().on("themeChanged", handler),
  /** Previews: the host switched between `preview` and `edit`. */
  onModeChange: (handler: (change: { mode: Mode }) => void): (() => void) =>
    current().on("modeChanged", handler),
  /** Previews: the file changed on disk. */
  onFileChange: (handler: (change: FileChange) => void): (() => void) =>
    current().on("fileChanged", handler),
};

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
 * Starts a frame: handshake, theme and base CSS, then `render(target)`. A thrown error is shown
 * in the frame (the host cannot see inside it) and rethrown. `render` may return a cleanup.
 */
export async function startFrame(options: {
  target: HTMLElement;
  render: (target: HTMLElement) => void | (() => void);
}): Promise<void> {
  try {
    const bridge = current();
    const value = await bridge.ready;
    await linkBaseCss(value.baseCssUrl);
    options.render(options.target);
  } catch (cause) {
    const message =
      cause instanceof BridgeError || cause instanceof Error
        ? cause.message
        : String(cause);
    options.target.textContent = `This extension view failed to start: ${message}`;
    throw cause;
  }
}
