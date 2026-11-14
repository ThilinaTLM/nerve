import { registerToolDefinitions } from "@nervekit/tools/catalog";
import { builtinExtensions } from "@nervekit/extensions";
import {
  createQuickScriptRegistry,
  quickScriptHostTools,
} from "@nervekit/tools/quick-script";

/**
 * The extensions this host serves, composed once from the built-in list
 * (`@nervekit/tools` cannot import them). The registry is passed explicitly to
 * everything that needs it: the tools, the description, the authorizer and the
 * availability.
 */
export const hostRegistry = createQuickScriptRegistry(builtinExtensions);

/**
 * Adds the tool definitions that other packages own to the tools catalog:
 * `quick_script` and the direct tools the extensions contribute. Safe to call
 * again; every composition root that reads the catalog calls it first.
 */
export function registerHostTools(): void {
  registerToolDefinitions(quickScriptHostTools(hostRegistry));
}
