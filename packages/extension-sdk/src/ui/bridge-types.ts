import type {
  BridgeParams,
  BridgeResult,
} from "@nervekit/contracts/extensions";

/*
 * The public types of the frame bridge, written out so the published declarations do not depend
 * on the private contracts package. The checks at the bottom fail the SDK's type check when
 * they drift from `bridgeMethods`.
 */

/** JSON a frame may send to its host or backend. */
export type BridgeJson =
  | string
  | number
  | boolean
  | null
  | BridgeJson[]
  | { [key: string]: BridgeJson };

/** Colour mode of the active theme. */
export type ThemeKind = "light" | "dark";
/** `preview` shows the file; `edit` is the frame's own editor (previews with `edit: "custom"`). Everything else is always `preview`. */
export type Mode = "preview" | "edit";
/** What kind of frame this is: a file `preview`, a tab `page` or a dock `panel`. */
export type ContributionKind = "preview" | "page" | "panel";
/** The `edit` setting of a preview: `source` (Nerve's editor), `custom` (the frame edits) or `none`. */
export type PreviewEdit = "source" | "custom" | "none";

/**
 * The `code` of a `BridgeError`. `invalid_request`: parameters do not match the method (the
 * message names the field). `not_allowed`: this kind of frame or edit mode may not call the method
 * (`file.*` in a page; `file.write` or `mode.get` in a preview without `edit: "custom"`).
 * `unknown_method`: no such bridge method. `not_found`: the file, page or backend method does not
 * exist. `too_large`: a message or value is over its size limit. `cancelled`: the user dismissed
 * the request. `backend_error`: the extension's backend method failed (the message is its
 * shortened error). `failed`: anything else, including a closed bridge or a host that did not answer.
 */
export type BridgeErrorCode =
  | "invalid_request"
  | "not_allowed"
  | "unknown_method"
  | "not_found"
  | "too_large"
  | "cancelled"
  | "backend_error"
  | "failed";

/** What `host.file.info()` returns: facts about the previewed file. */
export type FileInfo = {
  /** Project-relative path. */
  path: string;
  /** File name with its extension. */
  name: string;
  /** Lower-case extension with the dot, `""` when none. */
  extension: string;
  /** Size in bytes. */
  size: number;
  /** ISO timestamp of the last modification. */
  modifiedAt?: string | undefined;
};

/** One chunk of the previewed file, as `host.file.read` returns it. */
export type FileChunk = {
  /** Byte offset of this chunk in the file. */
  offset: number;
  /** The bytes, base64 encoded. */
  dataBase64: string;
  /** Decoded byte length of `dataBase64`. */
  length: number;
  /** Total size of the file in bytes. */
  size: number;
  /** `true` when this chunk reaches the end of the file. */
  eof: boolean;
};

/** One entry of a `host.ui.showMenu` menu. */
export type MenuItem = {
  /** Returned by `showMenu` when chosen; 1–64 characters. */
  id: string;
  /** Text shown; 1–200 characters. */
  label: string;
  /** Greyed out and not selectable. */
  disabled?: boolean | undefined;
  /** Drawn as a dangerous action (red). */
  destructive?: boolean | undefined;
};

/** Content of a `host.ui.confirm` dialog. */
export type ConfirmOptions = {
  /** Dialog title; 1–200 characters. */
  title: string;
  /** Body text; at most 20,000 characters. */
  message?: string | undefined;
  /** Text of the confirm button (at most 64 characters); default: the host's "Confirm". */
  confirmLabel?: string | undefined;
  /** Text of the cancel button (at most 64 characters); default: the host's "Cancel". */
  cancelLabel?: string | undefined;
  /** Style the confirm button as a destructive action. */
  destructive?: boolean | undefined;
};

/** Style of a `host.ui.notify` toast. Default `info`. */
export type NotifyLevel = "info" | "success" | "warning" | "error";

/** The open project, as `host.project.info()` returns it. */
export type ProjectInfo = {
  /** Project id. */
  id: string;
  /** Project name. */
  name: string;
  /** Absolute path of the project folder. */
  directory: string;
};

/** What the host tells the frame at the start: `host.ready` resolves with it (plus `baseCssUrl` and `tokensCss`, which the SDK applies). */
export type FrameInit = {
  /** Id of the extension that owns the frame. */
  extensionId: string;
  /** Which contribution this frame is. */
  contribution: {
    /** Preview, page or panel. */
    kind: ContributionKind;
    /** The contribution's `id` in the manifest. */
    id: string;
    /** Previews only: the preview's resolved `edit`. */
    edit?: PreviewEdit;
  };
  /** Current mode; always `preview` outside previews with `edit: "custom"`. */
  mode: Mode;
  /** Colour mode of the active theme. */
  themeKind: ThemeKind;
  /** Pages only: the `params` the page was opened with. */
  pageParams?: BridgeJson;
};

/** Payload of `host.onFileChange`: the previewed file changed on disk. */
export type FileChange = {
  /** New size in bytes. */
  size: number;
  /** ISO timestamp of the change. */
  modifiedAt?: string | undefined;
};

/** Payload of `host.onThemeChange`. */
export type ThemeChange = {
  /** Colour mode of the new theme. */
  kind: ThemeKind;
  /** Custom-property declarations (`--background:…;`) of the theme; the SDK has already applied them. */
  tokensCss: string;
};

/**
 * Every bridge method with its params and result. `host` wraps each one; use `BridgeClient.request`
 * only with a fake transport. Params and results are JSON; sizes are limited (see `host`).
 */
type Methods = {
  /** Previews only. Name, extension and size of the previewed file. */
  "file.info": { params: Record<string, never>; result: FileInfo };
  /** Previews only. One chunk: `length` default 262,144 bytes (256 KiB), at most 1,048,576 (1 MiB); `offset` default 0. */
  "file.read": {
    params: { offset?: number | undefined; length?: number | undefined };
    result: FileChunk;
  };
  /** Previews with `edit: "custom"` only. Replaces the file's content; at most 5 MiB decoded. `base64` encodes bytes. */
  "file.write": {
    params: { content: string; encoding: "utf8" | "base64" };
    result: { size: number };
  };
  /** Previews with `edit: "custom"` only. The current mode. */
  "mode.get": { params: Record<string, never>; result: { mode: Mode } };
  /** Calls one of the extension's own backend methods (`namespace.method`, at most 128 characters); `args` is its single argument (JSON, at most 1 MiB), `value` its result. The result must be JSON (at most about 8 MiB). Times out after 60 s with `backend_error`. */
  call: {
    params: { method: string; args?: BridgeJson | undefined };
    result: { value?: BridgeJson | undefined };
  };
  /** The extension's resolved, non-secret settings by field key. */
  "settings.get": {
    params: Record<string, never>;
    result: { values: Record<string, BridgeJson> };
  };
  /** State saved with `viewState.set`, kept with the tab; `null` when none. */
  "viewState.get": {
    params: Record<string, never>;
    result: { state: BridgeJson | null };
  };
  /** Saves JSON state with the tab (at most 64 KiB serialized). Hidden tabs and panels unload their frame, so save what must survive. */
  "viewState.set": {
    params: { state: BridgeJson };
    result: Record<string, never>;
  };
  /** Asks in a host dialog; `confirmed` is `false` when cancelled. */
  "ui.confirm": { params: ConfirmOptions; result: { confirmed: boolean } };
  /** Shows a host menu of 1–32 items; `position` is frame-relative CSS pixels. `id` of the chosen item, `null` when dismissed. */
  "ui.showMenu": {
    params: {
      items: MenuItem[];
      position?: { x: number; y: number } | undefined;
    };
    result: { id: string | null };
  };
  /** Shows a host toast (message 1–20,000 characters). */
  "ui.notify": {
    params: { message: string; level?: NotifyLevel | undefined };
    result: Record<string, never>;
  };
  /** Opens a project file (relative, or absolute inside the project; at most 4096 characters) in a tab. */
  openFile: { params: { path: string }; result: Record<string, never> };
  /** Opens one of the extension's pages by its manifest `id`; `params` (JSON, at most 4 KiB) reaches the page as `host.pageParams`. */
  openPage: {
    params: { id: string; params?: BridgeJson | undefined };
    result: Record<string, never>;
  };
  /** The open project. */
  "project.info": { params: Record<string, never>; result: ProjectInfo };
  /** Appends text (1–20,000 characters) to the chat composer. */
  "composer.insert": {
    params: { text: string };
    result: Record<string, never>;
  };
};
/** Params and result of every bridge method, by method name (`file.info`, `file.read`, …, `composer.insert`). */
export type BridgeMethods = Methods;
/** Name of a bridge method. */
export type MethodName = keyof Methods;

// Drift checks against the contracts: each side must be assignable to the other. Empty objects
// compare as `object` (`{}` and `Record<string, never>` are the same to the bridge).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Loose<T> = T extends Record<string, never> ? object : T;
type Checked = {
  [M in MethodName]: [
    Same<Loose<Methods[M]["params"]>, Loose<BridgeParams<M>>>,
    Same<Loose<Methods[M]["result"]>, Loose<BridgeResult<M>>>,
  ];
};
const checked: {
  [M in MethodName]: Checked[M] extends [true, true] ? true : never;
} = {} as never;
void checked;
