import { executeQuickScript } from "./runtime/quick-script.js";

export {
  createQuickScriptRegistry,
  findNamespace as findQuickScriptNamespace,
  installQuickScriptExtensions,
  quickScriptRegistry,
} from "./registry.js";
export type { QuickScriptRegistry } from "./registry.js";
export { quickScriptRiskOfMethod } from "./runtime/script-risk.js";
export type {
  ExtensionEnvironment,
  ExtensionManifest,
} from "./manifest-types.js";
export type { QuickScriptCapabilities } from "./runtime/description.js";
export { quickScriptDescription } from "./runtime/description.js";
export * from "./runtime/script-risk.js";
export { executeQuickScript };

export {
  createQuickScriptToolDefinition,
  quickScriptHostTools,
  quickScriptToolDefinition,
} from "./tool.js";
export { createExtensionToolDefinitions } from "./extension-host/direct-tools.js";
export {
  configuredNamespaces,
  deriveAvailability,
} from "./extension-host/availability.js";
export type {
  AvailabilityInput,
  DerivedAvailability,
  ExtensionState,
} from "./extension-host/availability.js";
export type { ExtensionHostPorts } from "./extension-host/ports.js";
export { createAvailabilityContext } from "./extension-host/host-context.js";
export { fromDefinition } from "./extension-host/from-definition.js";
export type {
  NamespaceAvailability,
  QuickScriptAvailability,
} from "./manifest-types.js";
export type { QuickScriptContext } from "./runtime/sdk-types.js";
export type {
  ImageBackendRequest,
  ImageGenerateRequest,
  ImageGenerateResponse,
  ImagegenBackend,
} from "./runtime/sdk-types.js";
