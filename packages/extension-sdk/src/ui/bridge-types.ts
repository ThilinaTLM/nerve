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

export type ThemeKind = "light" | "dark";
/** `preview` shows the file; `edit` is the frame's own editor (previews with `edit: "custom"`). */
export type Mode = "preview" | "edit";
export type ContributionKind = "preview" | "page" | "panel";
export type PreviewEdit = "source" | "custom" | "none";

export type BridgeErrorCode =
  | "invalid_request"
  | "not_allowed"
  | "unknown_method"
  | "not_found"
  | "too_large"
  | "cancelled"
  | "backend_error"
  | "failed";

export type FileInfo = {
  /** Project-relative path. */
  path: string;
  name: string;
  /** Lower-case extension with the dot, `""` when none. */
  extension: string;
  size: number;
  modifiedAt?: string | undefined;
};

export type FileChunk = {
  offset: number;
  /** The bytes, base64 encoded. */
  dataBase64: string;
  length: number;
  size: number;
  eof: boolean;
};

export type MenuItem = {
  id: string;
  label: string;
  disabled?: boolean | undefined;
  destructive?: boolean | undefined;
};

export type ConfirmOptions = {
  title: string;
  message?: string | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  destructive?: boolean | undefined;
};

export type NotifyLevel = "info" | "success" | "warning" | "error";

export type ProjectInfo = { id: string; name: string; directory: string };

/** What the host tells the frame at the start. */
export type FrameInit = {
  extensionId: string;
  contribution: { kind: ContributionKind; id: string; edit?: PreviewEdit };
  mode: Mode;
  themeKind: ThemeKind;
  /** Pages only: the `params` the page was opened with. */
  pageParams?: BridgeJson;
};

export type FileChange = { size: number; modifiedAt?: string | undefined };
export type ThemeChange = { kind: ThemeKind; tokensCss: string };

type Methods = {
  "file.info": { params: Record<string, never>; result: FileInfo };
  "file.read": {
    params: { offset?: number | undefined; length?: number | undefined };
    result: FileChunk;
  };
  "file.write": {
    params: { content: string; encoding: "utf8" | "base64" };
    result: { size: number };
  };
  "mode.get": { params: Record<string, never>; result: { mode: Mode } };
  call: {
    params: { method: string; args?: BridgeJson | undefined };
    result: { value?: BridgeJson | undefined };
  };
  "settings.get": {
    params: Record<string, never>;
    result: { values: Record<string, BridgeJson> };
  };
  "viewState.get": {
    params: Record<string, never>;
    result: { state: BridgeJson | null };
  };
  "viewState.set": {
    params: { state: BridgeJson };
    result: Record<string, never>;
  };
  "ui.confirm": { params: ConfirmOptions; result: { confirmed: boolean } };
  "ui.showMenu": {
    params: {
      items: MenuItem[];
      position?: { x: number; y: number } | undefined;
    };
    result: { id: string | null };
  };
  "ui.notify": {
    params: { message: string; level?: NotifyLevel | undefined };
    result: Record<string, never>;
  };
  openFile: { params: { path: string }; result: Record<string, never> };
  openPage: {
    params: { id: string; params?: BridgeJson | undefined };
    result: Record<string, never>;
  };
  "project.info": { params: Record<string, never>; result: ProjectInfo };
  "composer.insert": {
    params: { text: string };
    result: Record<string, never>;
  };
};
export type BridgeMethods = Methods;
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
