import type { ToolArgumentRiskClassifier, ToolExecutor } from "./contracts.js";

/**
 * The `quick_script` behaviour that lives in `@nervekit/quick-script`, which
 * depends on this package (it uses the Jira/Confluence/web/kroki clients and
 * execution primitives). The catalog keeps the tool's static definition and
 * reaches the runtime through this port; the host installs it once at startup.
 */
export interface QuickScriptRuntime {
  execute: ToolExecutor;
  /** Risk of one script from its text; policy matches rules against it. */
  classifyRisk: ToolArgumentRiskClassifier;
}

let installed: QuickScriptRuntime | undefined;

export function installQuickScriptRuntime(runtime: QuickScriptRuntime): void {
  installed = runtime;
}

function requireRuntime(): QuickScriptRuntime {
  if (!installed)
    throw new Error(
      "quick_script runtime is not installed (call installQuickScriptRuntime from @nervekit/tools/catalog at startup)",
    );
  return installed;
}

export const executeQuickScript: ToolExecutor = (args, context) =>
  requireRuntime().execute(args, context);

export const classifyQuickScriptRisk: ToolArgumentRiskClassifier = (args) =>
  requireRuntime().classifyRisk(args);
