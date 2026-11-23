import { ExtensionError, method } from "@nervekit/extension-api";
import {
  isArtifactName,
  nonEmptyString,
  parseOptions,
} from "@nervekit/extension-api/host";
import { assertCallOptions, imagegenSettingsOf } from "./backends.js";

export const MAX_PROMPT_CHARS = 32_000;
const MAX_INPUTS = 8;

/** What the user does when no image model is usable. */
export const IMAGEGEN_FIX =
  "Ask the user to choose an image model in Settings → Extensions → Image generation.";

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
    risk: "external_write",
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
      const image = ctx.models.image;
      const settings = imagegenSettingsOf(ctx);
      if (!image || !settings.model)
        throw new ExtensionError("DENIED", "No image model is selected.", {
          fix: IMAGEGEN_FIX,
        });
      const extra = backendOptions ?? {};
      const { images } = await image.generate({
        model: settings.model,
        prompt,
        inputs,
        size: size ?? settings.size,
        quality: (extra.quality as string | undefined) ?? settings.quality,
        background:
          (extra.background as string | undefined) ?? settings.background,
        artifact: name ? { name } : { baseName: "image" },
      });
      const first = images[0];
      if (!first)
        throw new ExtensionError(
          "SERVER_ERROR",
          "The image backend returned no images.",
        );
      return first.artifact.handle;
    },
  }),
};
