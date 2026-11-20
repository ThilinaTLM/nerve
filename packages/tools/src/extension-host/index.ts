/**
 * The extension host: loads extension code (in process or sandboxed) and serves its
 * direct tools, UI calls, account tests and icons. `quick-script` is one consumer.
 */
export { createExtensionToolDefinitions } from "./direct-tools.js";
export { configuredNamespaces, deriveAvailability } from "./availability.js";
export type {
  AvailabilityInput,
  DerivedAvailability,
  ExtensionState,
} from "./availability.js";
export {
  inProcessExtensionCode,
  type ExtensionCode,
  type ExtensionCodeAdapter,
  type ExtensionCodeHost,
} from "./code-adapter.js";
export {
  routedExtensionCode,
  sandboxExtensionCode,
  readSandboxedDefinitionData,
  type SandboxExtensionCodeOptions,
} from "./sandbox-adapter.js";
export { resolveExtensionIcon } from "./icon.js";
export type {
  ExtensionHostPorts,
  ExtensionStoreErrorCode,
  ExtensionStorePort,
} from "./ports.js";
export type {
  ExtensionAgentDiagnostic,
  ExtensionAgentError,
  ExtensionAgentPort,
  ExtensionAgentStatus,
} from "./agent-port.js";
export { openAvailabilityCode } from "./host-context.js";
export {
  callExtensionMethodFromUi,
  defaultUiCallTimeoutMs,
  ExtensionUiCallError,
  type ExtensionUiCall,
} from "./ui-call.js";
export {
  extensionMetadata,
  extensionSettingsDefinition,
} from "./descriptors.js";
export { accountKindIsTestable, testExtensionAccount } from "./account-test.js";
export type { AccountTestOutcome } from "./account-test.js";
