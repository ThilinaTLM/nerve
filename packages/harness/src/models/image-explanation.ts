import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "../agent/types/index.js";
import { normalizeImagesForModel } from "./image-normalization.js";
import { streamSimpleWithModel } from "./model-streaming.js";

const IMAGE_EXPLANATION_PROMPT = `Explain this image comprehensively for another model that cannot see it.
Be factual and precise. Include all visible text exactly, the layout and spatial relationships, objects and people, UI state, diagrams or charts, colors, and any details that may matter. Clearly distinguish direct observations from uncertain interpretations.`;

export type ImageExplanationAuth = {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
};

export async function explainImageWithModel(input: {
  model: Model<Api>;
  image: ImageContent;
  prompt?: string;
  thinkingLevel?: ThinkingLevel;
  onDelta?: (update: {
    kind: "thinking" | "text";
    delta: string;
  }) => void | Promise<void>;
  auth?: ImageExplanationAuth;
  signal?: AbortSignal;
}): Promise<string> {
  if (!(input.model.input ?? ["text"]).includes("image")) {
    throw new Error(
      "The configured image explanation model does not support image input.",
    );
  }
  const requestModel = input.auth?.baseUrl
    ? { ...input.model, baseUrl: input.auth.baseUrl }
    : input.model;
  const focus = input.prompt?.trim();
  const prompt = focus
    ? `${IMAGE_EXPLANATION_PROMPT}\n\nFocus on this request:\n${focus}`
    : IMAGE_EXPLANATION_PROMPT;
  const messages = await normalizeImagesForModel(
    [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, input.image],
        timestamp: Date.now(),
      },
    ],
    requestModel,
  );
  const reasoning =
    requestModel.reasoning &&
    input.thinkingLevel &&
    input.thinkingLevel !== "off"
      ? input.thinkingLevel
      : undefined;
  const stream = streamSimpleWithModel(
    requestModel,
    { messages },
    {
      apiKey: input.auth?.apiKey,
      headers: input.auth?.headers,
      env: input.auth?.env,
      reasoning,
      signal: input.signal,
    },
  );
  for await (const event of stream) {
    if (event.type !== "thinking_delta" && event.type !== "text_delta") {
      continue;
    }
    try {
      await input.onDelta?.({
        kind: event.type === "thinking_delta" ? "thinking" : "text",
        delta: event.delta,
      });
    } catch {
      // Live progress is best effort and must never fail image explanation.
    }
  }
  const response = await stream.result();
  const explanation = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!explanation) {
    throw new Error(
      "The configured vision model returned no text explanation.",
    );
  }
  return explanation;
}
