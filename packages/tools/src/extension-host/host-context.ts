import type { ExtensionManifest } from "../quick-script/manifest-types.js";
import type { QuickScriptRegistry } from "../quick-script/registry.js";
import { createSdkEnvironment } from "../quick-script/runtime/sdk.js";
import type { ExtensionCode } from "./code-adapter.js";
import type { ExtensionHostPorts } from "./ports.js";

/**
 * An extension's code for its `availability` hooks, outside any run: settings
 * and accounts work; artifacts need a conversation and fail when a hook uses
 * them. The caller disposes it.
 */
export async function openAvailabilityCode(
  registry: QuickScriptRegistry,
  extension: ExtensionManifest,
  ports: ExtensionHostPorts,
): Promise<ExtensionCode> {
  if (!extension.definition)
    throw new Error(`${extension.id} is not built on the extension API.`);
  const env = createSdkEnvironment({
    cwd: process.cwd(),
    registry,
    extensionPorts: ports,
  });
  return await env.extensions.code(extension.definition);
}
