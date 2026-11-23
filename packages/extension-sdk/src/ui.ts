// `@nervekit/extension-sdk/ui`: the bridge client every extension frame uses, the UI kit's
// components and the Lucide icons. Svelte sources of the components are compiled by the extension's own UI build
// (`nerve-ext build`), which also keeps this module a single instance per frame.
export { host, startFrame, type Host } from "./frame/host.js";
export {
  BridgeError,
  createBridgeClient,
  type BridgeClient,
  type BridgeTransport,
} from "./frame/client.js";
export type {
  Anchor,
  AnchorRect,
  BridgeErrorCode,
  BridgeJson,
  BridgeMethods,
  ClipboardImageType,
  ConfirmOptions,
  ContributionKind,
  FileChange,
  FileChunk,
  FileInfo,
  FrameInit,
  MenuEntry,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSubmenu,
  MethodName,
  Mode,
  NotifyLevel,
  PickItem,
  PickOptions,
  PickRequest,
  PreviewEdit,
  ProjectInfo,
  StoreChange,
  ThemeChange,
  ThemeKind,
} from "./frame/bridge-types.js";
export * from "./components/components.js";
// Icons: every Lucide icon under its Lucide name (`Plus`, `Check`), from the one copy of
// `@lucide/svelte` a frame resolves. A component of the same name wins (`Badge`); its icon is `BadgeIcon`.
export * from "@lucide/svelte";
export { Badge } from "./components/components.js";
