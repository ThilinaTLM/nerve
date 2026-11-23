import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import {
  describeBackend,
  imagegenSettingsOf,
  OPENAI_CODEX_BACKGROUNDS,
  OPENAI_CODEX_LEGACY_MODEL,
  OPENAI_CODEX_QUALITIES,
} from "./backends.js";
import { IMAGEGEN_FIX, imagegenMethods } from "./imagegen-methods.js";

const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));

/**
 * Settings v1 → v2: the `backend` and `model` enums become one `imageModel` setting. An entry
 * that set neither keeps no model: the user picks one (the host never picks an image model).
 */
function foldImageModel(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const { backend, model, ...rest } = settings;
  if (typeof backend !== "string" && typeof model !== "string") return rest;
  return {
    ...rest,
    model: {
      provider: typeof backend === "string" ? backend : "openai-codex",
      modelId: typeof model === "string" ? model : OPENAI_CODEX_LEGACY_MODEL,
    },
  };
}

/** Image generation: creates new images as artifacts. `image` transforms existing ones. */
export const imagegenExtension = defineExtension({
  id: "imagegen",
  name: "Image generation",
  description: "Generate images from a text prompt.",
  icon: "image-plus",
  enabledByDefault: false,
  settings: {
    version: 2,
    fields: {
      model: {
        type: "imageModel",
        label: "Model",
        description: "The image model that generates images.",
      },
      quality: {
        type: "enum",
        label: "Quality",
        description: "Default quality; a call can override it.",
        default: "auto",
        options: options(OPENAI_CODEX_QUALITIES),
      },
      size: {
        type: "string",
        label: "Size",
        description:
          '"auto" or width x height (multiples of 16, long edge up to 3840, ratio at most 3:1, 0.65 to 8.3 megapixels).',
        format: "text",
        default: "auto",
        placeholder: "auto",
        maxLength: 16,
        advanced: true,
      },
      background: {
        type: "enum",
        label: "Background",
        default: "auto",
        options: options(OPENAI_CODEX_BACKGROUNDS),
        advanced: true,
      },
    },
    // Version 1 chose the backend and model with two enums.
    migrations: { 2: foldImageModel },
  },
  permissions: { models: ["image"] },
  namespaces: [
    defineNamespace({
      id: "imagegen",
      label: "Image generation",
      summary: "generate an image from a prompt (spends the user's credit)",
      configuration: (ctx) => describeBackend(imagegenSettingsOf(ctx)),
      availability: async (ctx) => {
        const { model } = imagegenSettingsOf(ctx);
        return model && (await ctx.models.image?.ready({ model }))
          ? { available: true }
          : {
              available: false,
              reason: model
                ? "The selected image model is not available; its provider may need sign-in."
                : "No image model is selected.",
              fix: IMAGEGEN_FIX,
            };
      },
      methods: imagegenMethods,
      types: "",
      docs: [
        {
          id: "imagegen/generate",
          whenToRead: "before generating images or chaining them into pages",
          file: "docs/imagegen.md",
        },
      ],
    }),
  ],
});
