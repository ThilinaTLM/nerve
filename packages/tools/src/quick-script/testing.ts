/**
 * Runtime internals the built-in extensions' integration tests (which compose the
 * runtime with the built-in list) reach into. Not for production code; hosts use `./index.ts`.
 */
export {
  quickScriptFooter,
  reconcileReport,
  reportLines,
} from "./runtime/quick-script.js";
export type { ChangeReport } from "./runtime/quick-script.js";
export {
  createSdkEnvironment,
  findSdkMethod,
  preludesFor,
  sdkMethodNames,
} from "./runtime/sdk.js";
export { isOperationCheck } from "./runtime/sdk-types.js";
export type { MethodRisk } from "./runtime/sdk-types.js";
export {
  declarationLine,
  describeDeclarations,
  splitTypes,
  typePool,
} from "./runtime/sdk-dts.js";
export { DISCOVERY_BUDGET_CHARS } from "./runtime/discovery.js";
export { renderLimits } from "./limits.js";
export { nestedName } from "./runtime/test-nested.js";
export type { Nested } from "./runtime/test-nested.js";
