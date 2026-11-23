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
 * (`file.*` in a page; `file.write` in a preview without `edit: "custom"`).
 * `unknown_method`: no such bridge method. `not_found`: the file, page or backend method does not
 * exist. `too_large`: a message or value is over its size limit. `cancelled`: the user dismissed
 * the request. `backend_error`: the extension's backend method failed (the message is its
 * shortened error). `conflict`: a `store` write's `ifRevision` no longer matches the
 * stored revision. `failed`: anything else, including a closed bridge or a host that did not answer.
 */
export type BridgeErrorCode =
  | "invalid_request"
  | "not_allowed"
  | "unknown_method"
  | "not_found"
  | "too_large"
  | "cancelled"
  | "backend_error"
  | "conflict"
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

/** A rectangle in the frame's viewport, in CSS pixels (as `getBoundingClientRect` gives it); without `width` and `height` it is a point, such as the pointer. */
export type AnchorRect = {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width; default 0. */
  width?: number | undefined;
  /** Height; default 0. */
  height?: number | undefined;
};

/** What a host-drawn menu or picker opens next to: an element of the frame (the SDK measures it when the call is made) or a rectangle. */
export type Anchor = Element | AnchorRect;

/** A choice in a `host.ui.menu` menu. */
export type MenuItem = {
  /** Omit, or `"item"`. */
  type?: "item" | undefined;
  /** Returned by `menu` when chosen; unique in the menu; 1–128 characters. */
  id: string;
  /** Text shown; 1–200 characters. */
  label: string;
  /** Lucide icon by kebab-case name (`"file-text"`, `"trash-2"`), drawn by the host; an unknown name shows no icon. */
  icon?: string | undefined;
  /** Key hint shown at the end (`"Ctrl+K"`); it does not bind a key. At most 64 characters. */
  shortcut?: string | undefined;
  /** Shows a check mark: the state of a toggle. */
  checked?: boolean | undefined;
  /** Greyed out and not selectable. */
  disabled?: boolean | undefined;
  /** Drawn as a dangerous action (red). */
  destructive?: boolean | undefined;
};

/** Divider between groups of entries. */
export type MenuSeparator = {
  /** Always `"separator"`. */
  type: "separator";
};

/** Caption above the entries that follow it. */
export type MenuLabel = {
  /** Always `"label"`. */
  type: "label";
  /** Caption text; 1–200 characters. */
  label: string;
};

/** An entry that opens a nested menu. Submenus nest at most two deep. */
export type MenuSubmenu = {
  /** Always `"submenu"`. */
  type: "submenu";
  /** Text shown; 1–200 characters. */
  label: string;
  /** Lucide icon by kebab-case name. */
  icon?: string | undefined;
  /** Greyed out and not openable. */
  disabled?: boolean | undefined;
  /** The nested entries. */
  items: MenuEntry[];
};

/** One entry of a `host.ui.menu` menu: at most 200 in all, submenu entries included. */
export type MenuEntry = MenuItem | MenuSeparator | MenuLabel | MenuSubmenu;

/** A choice in a `host.ui.pick` list. */
export type PickItem = {
  /** Returned when chosen; unique in the list; 1–128 characters. */
  id: string;
  /** Text shown and searched; 1–200 characters. */
  label: string;
  /** Heading the item is listed under; typing the heading matches the whole group. */
  group?: string | undefined;
  /** Muted second line (at most 200 characters). */
  detail?: string | undefined;
  /** Extra search terms that are not shown (at most 16). */
  keywords?: string[] | undefined;
  /** Lucide icon by kebab-case name. */
  icon?: string | undefined;
  /** Not selectable. */
  disabled?: boolean | undefined;
};

/** What a `host.ui.pick` list shows, apart from its mode. */
export type PickOptions = {
  /** Heading of the list; 1–200 characters. */
  title?: string | undefined;
  /** Placeholder of the search field (shown for more than 8 items); 1–200 characters. */
  placeholder?: string | undefined;
  /** Accessible name of the list (required); 1–200 characters. */
  ariaLabel: string;
  /** The choices: 1–2,000. */
  items: PickItem[];
  /** Ids selected on open; at most one for `mode: "single"`. */
  selected?: string[] | undefined;
  /** Where the list opens; absent: centered in the frame. */
  anchor?: Anchor | undefined;
};

/** The options of `host.ui.pick` with its `mode`, as the fake host and the bridge see them. */
export type PickRequest = PickOptions & {
  /** `single` resolves with one id as soon as a row is chosen; `multiple` toggles rows and resolves with all chosen ids when applied. */
  mode: "single" | "multiple";
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

/** Payload of `host.file.onChange`: the previewed file changed on disk. */
export type FileChange = {
  /** New size in bytes. */
  size: number;
  /** ISO timestamp of the change. */
  modifiedAt?: string | undefined;
};

/** Payload of `host.theme.onChange`. */
export type ThemeChange = {
  /** Colour mode of the new theme. */
  kind: ThemeKind;
  /** Custom-property declarations (`--background:…;`) of the theme; the SDK has already applied them. */
  tokensCss: string;
};

/** Payload of `host.store.onChange`: a key of the extension's store changed. */
export type StoreChange = {
  /** The changed key. */
  key: string;
  /** The key's new revision; `null` when it was deleted. */
  revision: number | null;
};

/** Image types `host.clipboard.writeImage` accepts; the host converts JPEG and WebP to PNG. */
export type ClipboardImageType = "image/png" | "image/jpeg" | "image/webp";

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
  /** Calls one of the extension's own backend methods (`namespace.method`, at most 128 characters); `args` is its single argument (JSON, at most 1 MiB), `value` its result. The result must be JSON (at most about 8 MiB). Times out after 60 s with `backend_error`. */
  "backend.call": {
    params: { method: string; args?: BridgeJson | undefined };
    result: { value?: BridgeJson | undefined };
  };
  /** One of the extension's resolved, non-secret settings by field key; `value` is absent when it is unset. */
  "settings.get": {
    params: { key: string };
    result: { value?: BridgeJson | undefined };
  };
  /** State saved with `tabState.set`, kept with the tab; `null` when none. */
  "tabState.get": {
    params: Record<string, never>;
    result: { state: BridgeJson | null };
  };
  /** Saves JSON state with the tab (at most 64 KiB serialized). Hidden tabs and panels unload their frame, so save what must survive. */
  "tabState.set": {
    params: { state: BridgeJson };
    result: Record<string, never>;
  };
  /** Asks in a host dialog; `confirmed` is `false` when cancelled. Needs a user gesture in the frame, else `not_allowed`. */
  "ui.confirm": { params: ConfirmOptions; result: { confirmed: boolean } };
  /** Shows a menu drawn by the host next to `anchor` (CSS pixels in the frame). Needs a user gesture. `id` of the chosen item, `null` when dismissed. */
  "ui.menu": {
    params: { entries: MenuEntry[]; anchor: AnchorRect };
    result: { id: string | null };
  };
  /** Shows a choice list drawn by the host. Needs a user gesture. `ids` of the chosen items (one in `single` mode), `null` when dismissed or cancelled. */
  "ui.pick": {
    params: Omit<PickRequest, "anchor"> & { anchor?: AnchorRect | undefined };
    result: { ids: string[] | null };
  };
  /** Shows a host toast (message 1–20,000 characters). */
  "ui.notify": {
    params: { message: string; level?: NotifyLevel | undefined };
    result: Record<string, never>;
  };
  /** Opens a project file (relative, or absolute inside the project; at most 4096 characters) in a tab. */
  "workspace.openFile": {
    params: { path: string };
    result: Record<string, never>;
  };
  /** Opens one of the extension's pages by its manifest `id`; `params` (JSON, at most 4 KiB) reaches the page as `host.pages.params()`. */
  "pages.open": {
    params: { id: string; params?: BridgeJson | undefined };
    result: Record<string, never>;
  };
  /** The open project. */
  "project.info": { params: Record<string, never>; result: ProjectInfo };
  /** Appends text (1–20,000 characters) to the chat composer. */
  "chat.insert": {
    params: { text: string };
    result: Record<string, never>;
  };
  /** Copies text to the system clipboard (at most 1 MiB UTF-8). Needs a user click in the frame, else `not_allowed`. */
  "clipboard.writeText": {
    params: { text: string };
    result: Record<string, never>;
  };
  /** Copies an image to the system clipboard (base64, at most 5 MiB decoded). Needs a user click in the frame, else `not_allowed`. */
  "clipboard.writeImage": {
    params: { dataBase64: string; mediaType: ClipboardImageType };
    result: Record<string, never>;
  };
  /** Starts a conversation in the open project. Needs `"chat.startConversation"` in `permissions.frame` and a user click in the frame, else `not_allowed`. */
  "chat.startConversation": {
    params: {
      prompt: string;
      title?: string | undefined;
      model?: string | undefined;
      agentProfile?: string | undefined;
      permissionRuleSet?: string | undefined;
      send?: boolean | undefined;
      open?: boolean | undefined;
    };
    result: { conversationId: string };
  };
  /** One entry of the extension's store; `entry` is `null` when the key does not exist. */
  "store.get": {
    params: { key: string };
    result: { entry: { value: BridgeJson; revision: number } | null };
  };
  /** Writes a value (JSON, at most 4 MiB) and returns its new revision. With `ifRevision`, writes only when the stored revision matches (`0`: only when the key does not exist), else `conflict`. */
  "store.set": {
    params: {
      key: string;
      value: BridgeJson;
      ifRevision?: number | undefined;
    };
    result: { revision: number };
  };
  /** Deletes a key; deleting a missing key succeeds. With `ifRevision`, `conflict` when it does not match. */
  "store.delete": {
    params: { key: string; ifRevision?: number | undefined };
    result: Record<string, never>;
  };
  /** Keys of the store (optionally those starting with `prefix`) with their revision and serialized size in bytes. */
  "store.keys": {
    params: { prefix?: string | undefined };
    result: { keys: { key: string; revision: number; size: number }[] };
  };
};
/** Params and result of every bridge method, by method name (`file.info`, `file.read`, …, `chat.insert`). */
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
