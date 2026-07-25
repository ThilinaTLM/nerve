import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import { normalizeImagesForModel } from "./image-normalization.js";
import { streamSimpleWithModel } from "./provider-registry.js";
import { resolveAgentModel } from "./resolution.js";
import type { AgentPromptInput } from "./types.js";

export function streamAgentPrompt(
  input: AgentPromptInput,
): AsyncIterable<AssistantMessageEvent> {
  return (async function* streamNormalizedPrompt() {
    const resolvedModel = resolveAgentModel(input.model);
    const model = input.baseUrl
      ? { ...resolvedModel, baseUrl: input.baseUrl }
      : resolvedModel;
    const context: Context = {
      systemPrompt: input.systemPrompt,
      messages: await normalizeImagesForModel(input.messages, model),
    };
    yield* streamSimpleWithModel(model, context, {
      signal: input.signal,
      apiKey: input.apiKey,
      headers: input.headers,
      env: input.env,
      maxTokens: 4096,
    });
  })();
}
