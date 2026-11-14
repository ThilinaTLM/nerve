import type { ExtensionContext } from "@nervekit/extension-api";
import type { ExtensionManifest } from "../manifest-types.js";
import type { QuickScriptRegistry } from "../registry.js";
import { createSdkEnvironment } from "../runtime/sdk.js";
import type { ExtensionHostPorts } from "./ports.js";

/**
 * A `ctx` for an extension's `availability` hook, outside any run: settings and
 * accounts work; artifacts need a conversation and fail when a hook uses them.
 */
export function createAvailabilityContext(
  registry: QuickScriptRegistry,
  extension: ExtensionManifest,
  ports: ExtensionHostPorts,
): ExtensionContext {
  if (!extension.definition)
    throw new Error(`${extension.id} is not built on the extension API.`);
  const env = createSdkEnvironment({
    cwd: process.cwd(),
    registry,
    extensionPorts: ports,
  });
  return env.extensions.context(extension.definition);
}
