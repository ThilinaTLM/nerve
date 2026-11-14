import { registerToolDefinitions } from "@nervekit/tools/catalog";
import { quickScriptToolDefinition } from "@nervekit/quick-script";

/**
 * Adds the tool definitions that other packages own to the tools catalog:
 * `quick_script` lives in `@nervekit/quick-script`, which depends on tools.
 * Safe to call again; every composition root that reads the catalog calls it first.
 */
export function registerHostTools(): void {
  registerToolDefinitions([quickScriptToolDefinition]);
}
