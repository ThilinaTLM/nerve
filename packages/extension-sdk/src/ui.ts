// `@nervekit/extension-sdk/ui`: the bridge client every extension frame uses, plus the UI kit's
// components. Svelte sources of the components are compiled by the extension's own UI build
// (`nerve-ext build`), which also keeps this module a single instance per frame.
export { host, mode, themeKind, startFrame, type Host } from "./ui/host.js";
export {
  BridgeError,
  createBridgeClient,
  type BridgeClient,
  type BridgeTransport,
} from "./ui/client.js";
export type {
  BridgeJson,
  ConfirmOptions,
  ContributionKind,
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
} from "./ui/bridge-types.js";
export * from "./ui/components.js";
