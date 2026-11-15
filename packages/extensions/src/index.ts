import type { ExtensionDefinition } from "@nervekit/extension-api";
import { atlassianExtension } from "./atlassian/manifest.js";
import { diagramExtension } from "./diagram/manifest.js";
import { imageExplanationExtension } from "./image-explanation/manifest.js";
import { imagegenExtension } from "./imagegen/manifest.js";
import { webSearchExtension } from "./web-search/manifest.js";

/** The built-in extensions, in display order. The host registers them; nothing else outside this package names one. */
export const builtinExtensions: readonly ExtensionDefinition[] = [
  webSearchExtension,
  atlassianExtension,
  diagramExtension,
  imagegenExtension,
  imageExplanationExtension,
];
