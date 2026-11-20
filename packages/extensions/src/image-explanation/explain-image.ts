import {
  defineTool,
  ExtensionError,
  type ExtensionContext,
} from "@nervekit/extension-api";
import { nonEmptyString } from "@nervekit/extension-api/host";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const EXPLAIN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

const FIX =
  "Ask the user to choose an image-capable model in Settings → Extensions → Image explanation.";

type Input = { path: string; prompt?: string };

function parse(args: Record<string, unknown>): Input {
  const path = nonEmptyString(args.path, "path");
  if (args.prompt === undefined) return { path };
  return { path, prompt: nonEmptyString(args.prompt, "prompt") };
}

async function run(input: Input, ctx: ExtensionContext): Promise<string> {
  const vision = ctx.models.vision;
  if (!vision || !(await vision.ready()))
    throw new ExtensionError(
      "DENIED",
      "explain_image: no usable image model is configured.",
      { fix: FIX },
    );
  const info = await ctx.artifacts.info(input.path);
  if (info.bytes > EXPLAIN_IMAGE_MAX_BYTES)
    throw new ExtensionError(
      "BAD_REQUEST",
      `Image is too large for explain_image (${info.bytes} bytes; maximum ${EXPLAIN_IMAGE_MAX_BYTES} bytes).`,
    );
  const { bytes } = await ctx.artifacts.read(input.path);
  const { text } = await vision.explain({
    image: bytes,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    progress: { thinking: "thinking", text: "explanation" },
  });
  const explanation = text.trim();
  if (!explanation)
    throw new ExtensionError(
      "SERVER_ERROR",
      "The configured vision model returned no explanation.",
    );
  return explanation;
}

export const explainImageTool = defineTool({
  name: "explain_image",
  label: "Image explanation",
  description:
    "Describe an image in detail using the configured vision model; use when you can't view the image directly.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      prompt: {
        type: "string",
        description: "What to focus on.",
        minLength: 1,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  // Reads one file and sends it to the model the user selected, through a
  // provider already configured for the agent: a read, like the agent's own model calls.
  risk: "read",
  parse,
  // The file is read under the same rules as the `read` tool.
  authorize: ({ path }: Input) => ({
    toolName: "read",
    args: { path },
    summary: path,
  }),
  run,
  present: (explanation: string) => ({
    text: explanation,
    sections: { explanation },
  }),
  availability: async (ctx) =>
    (await ctx.models.vision?.ready())
      ? { available: true }
      : {
          available: false,
          reason: "No usable image-capable model is selected.",
          fix: FIX,
        },
  view: {
    header: { argument: "path", format: "path" },
    meta: ["prompt"],
    sections: [
      { id: "thinking", type: "text", label: "Thinking", live: "transient" },
      {
        id: "explanation",
        type: "markdown",
        label: "Explanation",
        live: "stream",
      },
    ],
  },
});
