import type { QuickScriptRuntime } from "@nervekit/tools/catalog";
import { executeQuickScript } from "./runtime/quick-script.js";
import { classifyQuickScriptArguments } from "./runtime/script-risk.js";

export {
  builtinExtensions,
  extensionMetadata,
  extensionSettingsDefinitions,
} from "./registry.js";
export { findNamespace as findQuickScriptNamespace } from "./registry.js";
export { quickScriptRiskOfMethod } from "./runtime/script-risk.js";
export type { ExtensionManifest } from "./manifest-types.js";
export type { QuickScriptCapabilities } from "./runtime/description.js";
export { quickScriptDescription } from "./runtime/description.js";
export * from "./runtime/script-risk.js";
export { executeQuickScript };

/** What the `quick_script` tool definition in `@nervekit/tools` delegates to; the host installs it with `installQuickScriptRuntime`. */
export const quickScriptRuntime: QuickScriptRuntime = {
  execute: executeQuickScript,
  classifyRisk: (args) => classifyQuickScriptArguments(args).risk,
};
