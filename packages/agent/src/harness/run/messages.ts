import type {
  AssistantMessage,
  ImageContent,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { AnyModel } from "../../types.js";

export function createUserMessage(
  text: string,
  images?: ImageContent[],
): UserMessage {
  const content: Array<{ type: "text"; text: string } | ImageContent> = [
    { type: "text", text },
  ];
  if (images) content.push(...images);
  return { role: "user", content, timestamp: Date.now() };
}

export function createFailureMessage(
  model: AnyModel,
  error: unknown,
  aborted: boolean,
): AssistantMessage {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: aborted
          ? "Agent run aborted."
          : `Agent run failed: ${errorMessage}`,
      },
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: aborted ? "aborted" : "error",
    errorMessage,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
