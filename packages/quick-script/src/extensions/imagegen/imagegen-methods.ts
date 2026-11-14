import { extname } from "node:path";
import { detectSupportedImageMimeType } from "@nervekit/tools/execution";
import {
  artifactNameOf,
  freshArtifactName,
  parseHandle,
  readAuthorizations,
  readFileRef,
  writeArtifact,
} from "../../runtime/files/artifacts.js";
import { nonEmptyString } from "../../runtime/sdk-args.js";
import { defineMethod, type SdkMethod } from "../../runtime/sdk-types.js";
import { resolveImagegenSettings, resolveRequest } from "./backends.js";

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
  const current = extname(name).toLowerCase();
  if (current === extension) return name;
  const stem = [".png", ".jpg", ".jpeg", ".webp"].includes(current)
    ? name.slice(0, -current.length)
    : name;
  return `${stem}${extension}`;
}

export const imagegenMethods: SdkMethod[] = [
  defineMethod({
    product: "imagegen",
    path: "generate",
    risk: "network",
    options: ["prompt", "size", "name", "inputs", "backendOptions"],
    signature:
      '/** Generates one image with the configured backend and returns it as an artifact handle (PNG, JPEG or WebP; the extension follows the data). size: "auto" or "<width>x<height>". Spends the user\'s credit: do not call it in loops. */ generate(options: { prompt: string; size?: string; name?: string; inputs?: FileHandle[]; backendOptions?: Record<string, string> }): Promise<FileHandle>',
    parse: (options) => {
      const prompt = nonEmptyString(options.prompt, "prompt").trim();
      if (prompt.length > MAX_PROMPT_CHARS)
        throw new Error(
          `prompt must not exceed ${MAX_PROMPT_CHARS} characters.`,
        );
      if (options.size !== undefined && typeof options.size !== "string")
        throw new Error('size must be a string such as "1536x1024" or "auto".');
      const inputs = options.inputs ?? [];
      if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS)
        throw new Error(
          `inputs must be an array of at most ${MAX_INPUTS} file handles.`,
        );
      const extra = options.backendOptions;
      if (
        extra !== undefined &&
        (typeof extra !== "object" || extra === null || Array.isArray(extra))
      )
        throw new Error("backendOptions must be an object.");
      return {
        prompt,
        size: options.size as string | undefined,
        name:
          options.name === undefined ? undefined : artifactNameOf(options.name),
        inputs: inputs as unknown[],
        backendOptions: extra as Record<string, unknown> | undefined,
      };
    },
    authorize: ({ prompt, size, inputs, backendOptions }, env) => {
      // Options are checked before authorization so a bad call never reaches the approval or the backend.
      resolveRequest(resolveImagegenSettings(env.context.imagegen), {
        size,
        backendOptions,
        inputs: inputs.length,
      });
      return {
        targets: [],
        summary: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
      };
    },
    authorizeAlso: ({ inputs }, env) =>
      readAuthorizations(inputs.map((input) => parseHandle(input, env))),
    resource: () => "the image backend",
    async run({ prompt, size, name, inputs, backendOptions }, env) {
      const { generateImage } = env.context;
      if (!generateImage)
        throw new Error("Image generation is not configured in Settings.");
      const options = resolveRequest(
        resolveImagegenSettings(env.context.imagegen),
        { size, backendOptions, inputs: inputs.length },
      );
      const references = [];
      for (const input of inputs) {
        const data = await readFileRef(parseHandle(input, env));
        const mimeType = detectSupportedImageMimeType(data);
        if (!mimeType)
          throw new Error(
            `inputs: ${String(input)} is not a PNG, JPEG or WebP image.`,
          );
        references.push({ data, mimeType });
      }
      const response = await generateImage({
        prompt,
        inputs: references,
        options,
        signal: env.context.signal,
      });
      const image = response.images[0];
      if (!image) throw new Error("The image backend returned no images.");
      if (
        image.data.byteLength === 0 ||
        image.data.byteLength > MAX_IMAGE_BYTES
      )
        throw new Error(
          `The image backend returned an invalid size (${image.data.byteLength} bytes).`,
        );
      const mimeType = detectSupportedImageMimeType(Buffer.from(image.data));
      const extension = mimeType ? EXTENSIONS[mimeType] : undefined;
      if (!extension)
        throw new Error(
          "The image backend returned an unsupported image format.",
        );
      return await writeArtifact(
        env,
        name
          ? nameFor(name, extension)
          : await freshArtifactName(env, "image", extension),
        Buffer.from(image.data),
      );
    },
  }),
];
