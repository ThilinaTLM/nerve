import type { HostExtensionDefinition } from "@nervekit/extension-api/host";
import { atlassianExtension } from "./atlassian/manifest.js";
import { diagramExtension } from "./diagram/manifest.js";
import { imageExplanationExtension } from "./image-explanation/manifest.js";
import { imagegenExtension } from "./imagegen/manifest.js";
import { webSearchExtension } from "./web-search/manifest.js";

/** The built-in extensions, in display order. The host registers them; nothing else outside this package names one. */
export const builtinExtensions: readonly HostExtensionDefinition[] = [
  webSearchExtension,
  atlassianExtension,
  diagramExtension,
  imagegenExtension,
  imageExplanationExtension,
];

/** The built-in extensions whose code runs in the sandbox (each has a `bundle.js` asset); the rest run in the host process. */
export const sandboxedBuiltinExtensions: ReadonlySet<string> = new Set([
  diagramExtension.id,
]);
