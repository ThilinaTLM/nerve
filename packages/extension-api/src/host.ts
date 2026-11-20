/**
 * Names for the host that runs extensions (`@nervekit/extension-api/host`). Authors never import
 * these: the author surface is `index.ts`, re-exported by `@nervekit/extension-sdk`.
 */
import type { ImageOptions, ImageRequest, ImageResult } from "./types.js";

export { EXTENSION_ERROR_CODES, isArtifactName } from "./errors.js";
export {
  DEFAULT_TOOL_VIEW,
  VIEW_SECTION_ID,
  VIEW_SECTION_TYPES,
  isMethodTool,
} from "./definition.js";
export { nonEmptyString, parseOptions } from "./options.js";
export { extensionDefinitionData } from "./data.js";
export type { ExtensionData, ExtensionDefinitionData } from "./data.js";

/** What the host's backend adapter executes. Extensions use `ImageRequest`. */
export type ImageBackendRequest = ImageOptions;

/** `ImageRequest` as the host's backend adapters receive it (the run's abort signal added). */
export type ImageGenerateRequest = ImageRequest & {
  /** Cancellation of the run. */
  signal?: AbortSignal;
};

/** `ImageResult` as the host's backend adapters return it. */
export type ImageGenerateResponse = ImageResult;
