import {
  ExtensionError,
  type ArtifactRef,
  type ExtensionDefinition,
  type ExtensionModels,
  type ImageModelSelection,
  type ModelProgress,
  type ModelSelection,
} from "@nervekit/extension-api";
import { sameModelSelection } from "@nervekit/extension-api/host";
import { detectSupportedImageMimeType } from "../execution/index.js";
import type { ExtensionHostPorts } from "./ports.js";

/** Largest image a vision call or an image generation input reads. */
export const MAX_MODEL_IMAGE_BYTES = 20 * 1024 * 1024;
/** Largest image a backend may return. */
const MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

type Selection = { provider: string; modelId: string; reasoningLevel?: string };

/** What the model services need from the runtime besides the ports. */
export type ModelServicesInput = {
  definition: ExtensionDefinition;
  settings: Record<string, unknown>;
  ports: ExtensionHostPorts;
  /** Reads an artifact or an authorized workspace file, at most `maxBytes`. */
  readImage(handle: string, maxBytes: number): Promise<Uint8Array>;
  /** Writes a generated image: the exact `name`, or a fresh `<base>-<n><extension>`. */
  writeImage(
    image: { bytes: Uint8Array; mediaType: string; extension: string },
    naming: { name?: string; baseName: string },
  ): Promise<ArtifactRef>;
  progress(section: string, chunk: string): void;
  signal: AbortSignal;
};

/** A model value as plain data; anything else is a bad request. */
function selectionOf(value: unknown, what: string): Selection {
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  if (
    !record ||
    typeof record.provider !== "string" ||
    typeof record.modelId !== "string" ||
    (record.reasoningLevel !== undefined &&
      typeof record.reasoningLevel !== "string")
  )
    throw new ExtensionError(
      "BAD_REQUEST",
      `${what} must be a model selection { provider, modelId }.`,
      {
        fix: "Pass the value of one of your model settings (ctx.settings.get(<key>)).",
      },
    );
  return {
    provider: record.provider,
    modelId: record.modelId,
    ...(typeof record.reasoningLevel === "string"
      ? { reasoningLevel: record.reasoningLevel }
      : {}),
  };
}

const onDelta =
  (
    progress: ModelProgress | undefined,
    write: ModelServicesInput["progress"],
  ) =>
  ({ kind, delta }: { kind: "thinking" | "text"; delta: string }) => {
    const section = kind === "thinking" ? progress?.thinking : progress?.text;
    if (section) write(section, delta);
  };

/**
 * `ctx.models` of one extension. Every call names its model, and the host accepts only the value
 * of one of the extension's own settings of the matching type (`model` for text and vision,
 * `imageModel` for images) or, for text and vision, Nerve's default: an extension cannot spend
 * credit on, or send data to, a model the user did not choose.
 */
export function createModelServices(
  input: ModelServicesInput,
): ExtensionModels {
  const { definition, settings, ports, signal } = input;
  const granted = definition.permissions?.models ?? [];
  const settingValues = (type: "model" | "imageModel") =>
    Object.entries(definition.settings.fields)
      .filter(([, field]) => field.type === type)
      .map(([key]) => settings[key])
      .filter((value) => value !== null && typeof value === "object");
  const defaultModel = async (): Promise<ModelSelection | undefined> =>
    await ports.defaultModel?.();

  /** The checked selection, or `DENIED` when it is none of the allowed values. */
  const checked = async (
    type: "model" | "imageModel",
    value: unknown,
  ): Promise<Selection> => {
    const selection = selectionOf(value, "model");
    const allowed = settingValues(type).some((candidate) => {
      try {
        return sameModelSelection(selectionOf(candidate, "setting"), selection);
      } catch {
        return false;
      }
    });
    if (allowed) return selection;
    if (type === "model") {
      const fallback = await defaultModel();
      if (fallback && sameModelSelection(fallback, selection)) return selection;
    }
    throw new ExtensionError(
      "DENIED",
      `${selection.provider}/${selection.modelId} is not a model the user chose for this extension.`,
      {
        fix:
          type === "model"
            ? "Pass the value of one of your `model` settings or of ctx.models.defaultModel()."
            : "Pass the value of one of your `imageModel` settings.",
      },
    );
  };
  /** `ready`: false for an absent or not allowed model instead of an error. */
  const readyWith = async <T>(
    type: "model" | "imageModel",
    value: unknown,
    ready: (selection: T) => Promise<boolean>,
  ): Promise<boolean> => {
    if (value === undefined || value === null) return false;
    try {
      return await ready((await checked(type, value)) as T);
    } catch {
      return false;
    }
  };

  const models: ExtensionModels = {};
  const { generateImage, imageReady } = ports;
  if (generateImage && imageReady && granted.includes("image"))
    models.image = {
      generate: async (request) => {
        const model = (await checked(
          "imageModel",
          request.model,
        )) as ImageModelSelection;
        const inputs = [];
        for (const handle of request.inputs ?? []) {
          const data = await input.readImage(handle, MAX_MODEL_IMAGE_BYTES);
          const mimeType = detectSupportedImageMimeType(data);
          if (!mimeType)
            throw new ExtensionError(
              "BAD_REQUEST",
              `inputs: ${handle} is not a PNG, JPEG, GIF or WebP image.`,
            );
          inputs.push({ data, mimeType });
        }
        const response = await generateImage({
          model: { provider: model.provider, modelId: model.modelId },
          prompt: request.prompt,
          inputs,
          options: {
            ...(request.size !== undefined ? { size: request.size } : {}),
            ...(request.quality !== undefined
              ? { quality: request.quality }
              : {}),
            ...(request.background !== undefined
              ? { background: request.background }
              : {}),
          },
          signal,
        });
        if (response.images.length === 0)
          throw new ExtensionError(
            "SERVER_ERROR",
            "The image backend returned no images.",
          );
        const images = [];
        for (const [index, image] of response.images.entries()) {
          const size = image.data.byteLength;
          if (size === 0 || size > MAX_GENERATED_IMAGE_BYTES)
            throw new ExtensionError(
              "SERVER_ERROR",
              `The image backend returned an invalid size (${size} bytes).`,
            );
          const mediaType = detectSupportedImageMimeType(image.data);
          const extension = mediaType ? IMAGE_EXTENSIONS[mediaType] : undefined;
          if (!mediaType || !extension)
            throw new ExtensionError(
              "SERVER_ERROR",
              "The image backend returned an unsupported image format.",
            );
          const name = index === 0 ? request.artifact?.name : undefined;
          const artifact = await input.writeImage(
            { bytes: image.data, mediaType, extension },
            {
              ...(name !== undefined ? { name } : {}),
              baseName: request.artifact?.baseName ?? "image",
            },
          );
          images.push({
            artifact,
            ...(image.revisedPrompt !== undefined
              ? { revisedPrompt: image.revisedPrompt }
              : {}),
          });
        }
        return { model: response.model, images };
      },
      ready: async (request) =>
        await readyWith("imageModel", request?.model, imageReady),
    };
  const { explainImage, visionReady } = ports;
  if (explainImage && visionReady && granted.includes("vision"))
    models.vision = {
      explain: async (request) => {
        const model = (await checked("model", request.model)) as ModelSelection;
        if (typeof request.image !== "string")
          throw new ExtensionError(
            "BAD_REQUEST",
            "image must be a file handle (artifact:<name> or a workspace path).",
          );
        const image = await input.readImage(
          request.image,
          MAX_MODEL_IMAGE_BYTES,
        );
        return await explainImage({
          model,
          image,
          ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
          onDelta: onDelta(request.progress, input.progress),
          signal,
        });
      },
      ready: async (request) =>
        await readyWith("model", request?.model, visionReady),
    };
  const { completeText, textReady } = ports;
  if (completeText && textReady && granted.includes("text"))
    models.text = {
      complete: async (request) =>
        await completeText({
          model: (await checked("model", request.model)) as ModelSelection,
          ...(request.system !== undefined ? { system: request.system } : {}),
          prompt: request.prompt,
          ...(request.maxTokens !== undefined
            ? { maxTokens: request.maxTokens }
            : {}),
          onDelta: onDelta(request.progress, input.progress),
          signal,
        }),
      ready: async (request) =>
        await readyWith("model", request?.model, textReady),
    };
  if (models.text || models.vision)
    models.defaultModel = async () => {
      const model = await defaultModel();
      if (!model)
        throw new ExtensionError("DENIED", "Nerve has no default model.", {
          fix: "Ask the user to choose a default model in Nerve's settings.",
        });
      return model;
    };
  return models;
}

/** The artifact name for an image: `name` with its extension corrected to the image's type. */
export function imageArtifactName(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  const current = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (current === extension) return name;
  const stem = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(current)
    ? name.slice(0, -current.length)
    : name;
  return `${stem}${extension}`;
}
