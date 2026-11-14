import { registerToolDefinitions } from "@nervekit/tools/catalog";
import { builtinExtensions } from "@nervekit/extensions";
import {
  installQuickScriptExtensions,
  quickScriptToolDefinition,
} from "@nervekit/tools/quick-script";

/**
 * Adds the tool definitions that other packages own to the tools catalog and
 * installs the built-in extensions the `quick_script` runtime serves
 * (`@nervekit/tools` cannot import them). Safe to call again; every
 * composition root that reads the catalog calls it first.
 */
export function registerHostTools(): void {
  installQuickScriptExtensions(builtinExtensions);
  registerToolDefinitions([quickScriptToolDefinition]);
}
