import type { ExtensionDefinition } from "@nervekit/extension-api";
import { atlassianExtension } from "./atlassian/manifest.js";
import { diagramExtension } from "./diagram/manifest.js";
import { imagegenExtension } from "./imagegen/manifest.js";
import { webExtension } from "./web/manifest.js";

/** The built-in extensions, in display order. The host registers them; nothing else outside this package names one. */
export const builtinExtensions: readonly ExtensionDefinition[] = [
  atlassianExtension,
  webExtension,
  imagegenExtension,
  diagramExtension,
];
