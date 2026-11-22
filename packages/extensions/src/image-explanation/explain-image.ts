import {
  defineTool,
  ExtensionError,
  type ExtensionContext,
  type ExtensionHookContext,
  type ModelSelection,
} from "@nervekit/extension-api";
import { nonEmptyString } from "@nervekit/extension-api/host";

const FIX =
  "Ask the user to choose an image-capable model in Settings → Extensions → Image explanation.";

type Input = { path: string; prompt?: string };

function parse(args: Record<string, unknown>): Input {
  const path = nonEmptyString(args.path, "path");
  if (args.prompt === undefined) return { path };
  return { path, prompt: nonEmptyString(args.prompt, "prompt") };
}

/** The `model` setting: the image-capable model the user chose. */
const selectedModel = (ctx: Pick<ExtensionHookContext, "settings">) =>
  ctx.settings.get<ModelSelection>("model");

async function run(input: Input, ctx: ExtensionContext): Promise<string> {
  const vision = ctx.models.vision;
  const model = selectedModel(ctx);
  if (!vision || !model)
    throw new ExtensionError(
      "DENIED",
      "explain_image: no image-capable model is selected.",
      { fix: FIX },
    );
  // The host reads the file under the `read` rules declared in `authorize`, up to 20 MiB.
  const { text } = await vision.explain({
    model,
    image: input.path,
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
    (await ctx.models.vision?.ready({ model: selectedModel(ctx) }))
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
