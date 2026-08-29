import type { Message } from "@earendil-works/pi-ai";

const TOOL_RESULT_MAX_CHARS = 2000;
const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
};
const truncateForSummary = (text: string): string =>
  text.length <= TOOL_RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n\n[... ${text.length - TOOL_RESULT_MAX_CHARS} more characters truncated]`;

/** Serialize model messages to bounded plain text for summarization prompts. */
export function serializeConversation(messages: Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter(
                (block): block is { type: "text"; text: string } =>
                  block.type === "text",
              )
              .map((block) => block.text)
              .join("");
      if (content) parts.push(`[User]: ${content}`);
    } else if (message.role === "assistant") {
      const text: string[] = [],
        thinking: string[] = [],
        tools: string[] = [];
      for (const block of message.content) {
        if (block.type === "text") text.push(block.text);
        else if (block.type === "thinking") thinking.push(block.thinking);
        else if (block.type === "toolCall") {
          const args = Object.entries(
            block.arguments as Record<string, unknown>,
          )
            .map(([key, value]) => `${key}=${safeJsonStringify(value)}`)
            .join(", ");
          tools.push(`${block.name}(${args})`);
        }
      }
      if (thinking.length)
        parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
      if (text.length) parts.push(`[Assistant]: ${text.join("\n")}`);
      if (tools.length)
        parts.push(`[Assistant tool calls]: ${tools.join("; ")}`);
    } else if (message.role === "toolResult") {
      const content = message.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("");
      if (content) parts.push(`[Tool result]: ${truncateForSummary(content)}`);
    }
  }
  return parts.join("\n\n");
}
