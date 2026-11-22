/**
 * Names for the host that runs extensions (`@nervekit/extension-api/host`). Authors never import
 * these: the author surface is `index.ts`, re-exported by `@nervekit/extension-sdk`.
 */
import type {
  ImageModelSelection,
  ModelSelection,
  VisionResult,
} from "./types.js";

export { EXTENSION_ERROR_CODES, isArtifactName } from "./errors.js";
export {
  DEFAULT_TOOL_VIEW,
  VIEW_SECTION_ID,
  VIEW_SECTION_TYPES,
  isMethodTool,
} from "./definition.js";
export { nonEmptyString, parseOptions } from "./options.js";
export { credentialOperations } from "./credentials.js";
export { extensionDefinitionData } from "./data.js";
export type { ExtensionData, ExtensionDefinitionData } from "./data.js";

/** A model's streamed output, as the host's model adapters report it. */
export type ModelDelta = { kind: "thinking" | "text"; delta: string };

/** `VisionRequest` as the host's vision adapter receives it: the selection checked, the image read. */
export type VisionExplainRequest = {
  /** A selection the runtime checked against the extension's settings and the default. */
  model: ModelSelection;
  /** Image bytes. */
  image: Uint8Array;
  /** What to focus on. */
  prompt?: string;
  /** Streamed thinking and answer chunks. */
  onDelta?: (update: ModelDelta) => void;
  /** Cancellation of the run. */
  signal?: AbortSignal;
};

/** What the host's vision adapter returns. */
export type VisionExplainResponse = VisionResult;

/** `TextRequest` as the host's text adapter receives it: the selection checked. */
export type TextCompleteRequest = {
  /** A selection the runtime checked against the extension's settings and the default. */
  model: ModelSelection;
  /** Instructions for the model. */
  system?: string;
  /** The user message. */
  prompt: string;
  /** Upper bound on the answer's length in tokens. */
  maxTokens?: number;
  /** Streamed thinking and answer chunks. */
  onDelta?: (update: ModelDelta) => void;
  /** Cancellation of the run. */
  signal?: AbortSignal;
};

/** Options of an image request the backend validates; absent means `auto`. */
export type ImageBackendOptions = {
  size?: string;
  quality?: string;
  background?: string;
};

/** `ImageRequest` as the host's image backends receive it: the selection checked, the inputs read. */
export type ImageGenerateRequest = {
  /** A selection the runtime checked against the extension's `imageModel` settings. */
  model: ImageModelSelection;
  /** What to draw. */
  prompt: string;
  /** Reference images, read from their handles. */
  inputs: readonly { data: Uint8Array; mimeType: string }[];
  /** Options for the backend to validate. */
  options: ImageBackendOptions;
  /** Cancellation of the run. */
  signal?: AbortSignal;
};

/** What an image backend returns; the runtime writes the images as artifacts. */
export type ImageGenerateResponse = {
  /** Model that produced the images (`provider/modelId`). */
  model: string;
  /** The images in order. */
  images: readonly { data: Uint8Array; revisedPrompt?: string }[];
};

/** Whether two model selections are the same choice: provider, model id and reasoning level. */
export function sameModelSelection(
  a: { provider: string; modelId: string; reasoningLevel?: string },
  b: { provider: string; modelId: string; reasoningLevel?: string },
): boolean {
  return (
    a.provider === b.provider &&
    a.modelId === b.modelId &&
    (a.reasoningLevel ?? undefined) === (b.reasoningLevel ?? undefined)
  );
}
