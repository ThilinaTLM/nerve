import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import {
  describeBackend,
  imagegenSettingsOf,
  IMAGEGEN_BACKENDS,
  OPENAI_CODEX_BACKGROUNDS,
  OPENAI_CODEX_MODELS,
  OPENAI_CODEX_QUALITIES,
} from "./backends.js";
import { imagegenMethods } from "./imagegen-methods.js";

const codex = { field: "backend", equals: "openai-codex" } as const;
const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));

/** Image generation: creates new images as artifacts. `image` transforms existing ones. */
export const imagegenExtension = defineExtension({
  id: "imagegen",
  name: "Image generation",
  description: "Generate images from a text prompt.",
  apiVersion: 1,
  icon: "image-plus",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      backend: {
        type: "enum",
        label: "Backend",
        description: "Where images are generated.",
        default: "openai-codex",
        options: IMAGEGEN_BACKENDS.map((value) => ({
          value,
          label: "OpenAI Codex (ChatGPT subscription)",
        })),
      },
      model: {
        type: "enum",
        label: "Model",
        default: "gpt-image-2.5-flare",
        options: options(OPENAI_CODEX_MODELS),
        visibleWhen: codex,
      },
      quality: {
        type: "enum",
        label: "Quality",
        description: "Default quality; a call can override it.",
        default: "auto",
        options: options(OPENAI_CODEX_QUALITIES),
        visibleWhen: codex,
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
        visibleWhen: codex,
        advanced: true,
      },
      background: {
        type: "enum",
        label: "Background",
        default: "auto",
        options: options(OPENAI_CODEX_BACKGROUNDS),
        visibleWhen: codex,
        advanced: true,
      },
    },
  },
  permissions: { capabilities: ["models.image"] },
  namespaces: [
    defineNamespace({
      id: "imagegen",
      summary: "generate an image from a prompt (spends the user's credit)",
      configuration: (ctx) => describeBackend(imagegenSettingsOf(ctx)),
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
