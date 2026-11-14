import {
  ExtensionError,
  isArtifactName,
  method,
  nonEmptyString,
  parseOptions,
} from "@nervekit/extension-api";
import {
  assertCallOptions,
  imagegenSettingsOf,
  resolveImagegenSettings,
  resolveRequest,
} from "./backends.js";
import { supportedImageType } from "./image-type.js";

export const MAX_PROMPT_CHARS = 32_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_INPUTS = 8;

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/** The artifact name with the extension of the data the backend returned. */
function nameFor(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  const current = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (current === extension) return name;
  const stem = [".png", ".jpg", ".jpeg", ".webp"].includes(current)
    ? name.slice(0, -current.length)
    : name;
  return `${stem}${extension}`;
}

/** The artifact name of a given name or `artifact:` handle. */
function artifactNameOf(value: unknown): string {
  const name =
    typeof value === "string" && value.startsWith("artifact:")
      ? value.slice("artifact:".length)
      : value;
  if (typeof name !== "string" || !isArtifactName(name))
    throw new ExtensionError(
      "BAD_REQUEST",
      `Invalid artifact name ${JSON.stringify(name)}: use 1-128 letters, digits, spaces, '.', '_' or '-' (no folders, no leading dot).`,
    );
  return name;
}

export const imagegenMethods = {
  generate: method({
    risk: "network",
    signature:
      '/** Generates one image with the configured backend and returns it as an artifact handle (PNG, JPEG or WebP; the extension follows the data). size: "auto" or "<width>x<height>". Spends the user\'s credit: do not call it in loops. */ generate(options: { prompt: string; size?: string; name?: string; inputs?: FileHandle[]; backendOptions?: Record<string, string> }): Promise<FileHandle>',
    parse: (args) => {
      const options = parseOptions("imagegen.generate", args, {
        options: ["prompt", "size", "name", "inputs", "backendOptions"],
      });
      const bad = (message: string) =>
        new ExtensionError("BAD_REQUEST", message);
      const prompt = nonEmptyString(options.prompt, "prompt");
      if (prompt.length > MAX_PROMPT_CHARS)
        throw bad(`prompt must not exceed ${MAX_PROMPT_CHARS} characters.`);
      if (options.size !== undefined && typeof options.size !== "string")
        throw bad('size must be a string such as "1536x1024" or "auto".');
      const inputs = options.inputs ?? [];
      if (
        !Array.isArray(inputs) ||
        inputs.length > MAX_INPUTS ||
        inputs.some((input) => typeof input !== "string" || !input.trim())
      )
        throw bad(
          `inputs must be an array of at most ${MAX_INPUTS} file handles.`,
        );
      const extra = options.backendOptions;
      if (
        extra !== undefined &&
        (typeof extra !== "object" || extra === null || Array.isArray(extra))
      )
        throw bad("backendOptions must be an object.");
      const call = {
        prompt,
        size: options.size as string | undefined,
        name:
          options.name === undefined ? undefined : artifactNameOf(options.name),
        inputs: inputs as string[],
        backendOptions: extra as Record<string, unknown> | undefined,
      };
      // Options that do not depend on the settings are checked before any approval or backend call.
      assertCallOptions(call);
      return call;
    },
    authorize: ({ prompt, inputs }) => [
      {
        targets: [],
        summary: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
      },
      // Workspace files used as references are checked as reads; artifacts are the run's own files.
      ...inputs
        .filter((input) => !input.startsWith("artifact:"))
        .map((path) => ({ toolName: "read", args: { path }, summary: path })),
    ],
    resource: () => "the image backend",
    async run(_session, { prompt, size, name, inputs, backendOptions }, ctx) {
      const generate = ctx.models.image?.generate;
      if (!generate)
        throw new ExtensionError(
          "BAD_REQUEST",
          "Image generation is not configured in Settings.",
        );
      const options = resolveRequest(
        resolveImagegenSettings(imagegenSettingsOf(ctx)),
        {
          size,
          backendOptions,
          inputs: inputs.length,
        },
      );
      const references = [];
      for (const input of inputs) {
        const { bytes } = await ctx.artifacts.read(input);
        const mimeType = supportedImageType(bytes);
        if (!mimeType)
          throw new ExtensionError(
            "BAD_REQUEST",
            `inputs: ${input} is not a PNG, JPEG or WebP image.`,
          );
        references.push({ data: bytes, mimeType });
      }
      const response = await generate({ prompt, inputs: references, options });
      const image = response.images[0];
      if (!image)
        throw new ExtensionError(
          "SERVER_ERROR",
          "The image backend returned no images.",
        );
      if (
        image.data.byteLength === 0 ||
        image.data.byteLength > MAX_IMAGE_BYTES
      )
        throw new ExtensionError(
          "SERVER_ERROR",
          `The image backend returned an invalid size (${image.data.byteLength} bytes).`,
        );
      const mimeType = supportedImageType(image.data);
      const extension = mimeType ? EXTENSIONS[mimeType] : undefined;
      if (!mimeType || !extension)
        throw new ExtensionError(
          "SERVER_ERROR",
          "The image backend returned an unsupported image format.",
        );
      const written = await ctx.artifacts.write(
        name
          ? nameFor(name, extension)
          : await ctx.artifacts.freshName("image", extension),
        image.data,
        mimeType,
      );
      return written.handle;
    },
  }),
};
