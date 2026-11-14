import { installQuickScriptExtensions } from "@nervekit/tools/quick-script";
import { builtinExtensions } from "../src/index.js";

/** Tests that exercise the runtime together with the built-ins import this first. */
const registry = installQuickScriptExtensions(builtinExtensions);

export const registeredNamespaces = registry.namespaces;
export const registeredMethods = registry.methods;
