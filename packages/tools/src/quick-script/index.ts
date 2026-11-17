import { executeQuickScript } from "./runtime/quick-script.js";

export {
  createQuickScriptRegistry,
  reservedNamespaceIds,
  findNamespace as findQuickScriptNamespace,
} from "./registry.js";
export type {
  QuickScriptRegistry,
  QuickScriptRegistryOptions,
} from "./registry.js";
export { quickScriptRiskOfMethod } from "./runtime/script-risk.js";
export type { ExtensionManifest } from "./manifest-types.js";
export type { QuickScriptCapabilities } from "./runtime/description.js";
export { quickScriptDescription } from "./runtime/description.js";
export * from "./runtime/script-risk.js";
export { executeQuickScript };

export {
  createQuickScriptToolDefinition,
  quickScriptHostTools,
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
export {
  inProcessExtensionCode,
  type ExtensionCode,
  type ExtensionCodeAdapter,
  type ExtensionCodeHost,
} from "./extension-host/code-adapter.js";
export {
  routedExtensionCode,
  sandboxExtensionCode,
  readSandboxedDefinitionData,
  type SandboxExtensionCodeOptions,
} from "./extension-host/sandbox-adapter.js";
export { resolveExtensionIcon } from "./extension-host/icon.js";
export type { ExtensionHostPorts } from "./extension-host/ports.js";
export type {
  ExtensionAgentDiagnostic,
  ExtensionAgentError,
  ExtensionAgentPort,
  ExtensionAgentStatus,
} from "./extension-host/agent-port.js";
export { openAvailabilityCode } from "./extension-host/host-context.js";
export {
  callExtensionMethodFromUi,
  defaultUiCallTimeoutMs,
  ExtensionUiCallError,
  type ExtensionUiCall,
} from "./extension-host/ui-call.js";
export {
  extensionMetadata,
  extensionSettingsDefinition,
} from "./extension-host/descriptors.js";
export {
  accountKindIsTestable,
  testExtensionAccount,
} from "./extension-host/account-test.js";
export type { AccountTestOutcome } from "./extension-host/account-test.js";
export type {
  NamespaceAvailability,
  QuickScriptAvailability,
} from "./manifest-types.js";
export type { QuickScriptContext } from "./runtime/sdk-types.js";
