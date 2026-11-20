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
export type { ExtensionManifest } from "./manifest-types.js";
export type { QuickScriptCapabilities } from "./runtime/description.js";
export { quickScriptDescription } from "./runtime/description.js";
export {
  describeQuickScriptRisk,
  quickScriptRiskOfMethod,
  quickScriptRiskOfToolRisk,
  quickScriptRiskWithin,
  quickScriptToolRisk,
  assertDeclaredRisk,
} from "./runtime/script-risk.js";
export type { QuickScriptRisk } from "./runtime/script-risk.js";
export {
  classifyQuickScriptArguments,
  classifyQuickScriptScript,
  summarizeScannedCalls,
} from "./runtime/script-classifier.js";
export type {
  QuickScriptClassification,
  ScannedCall,
} from "./runtime/script-classifier.js";
export { executeQuickScript };

export {
  createQuickScriptToolDefinition,
  quickScriptHostTools,
} from "./tool.js";
export type {
  ConfigurationAgentPort,
  ConfigurationAgentResult,
  ConfigurationAgentScope,
} from "./runtime/configuration/configuration-port.js";
export type {
  NamespaceAvailability,
  QuickScriptAvailability,
} from "./manifest-types.js";
export type { QuickScriptContext } from "./runtime/sdk-types.js";
