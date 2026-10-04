import type { Message } from "@earendil-works/pi-ai";

const TOOL_RESULT_MAX_CHARS = 2000;
const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
};
const references = (text: string) =>
  [
    ...new Set(
      text.match(
        /(?:\/[\w.@+~-]+)+|(?:[\w.@+~-]+\/)+[\w.@+~-]+|(?:artifact|file):\/\/[^\s)]+/g,
      ) ?? [],
    ),
  ]
    .slice(0, 40)
    .join("\n");
const truncateForSummary = (text: string): string =>
  text.length <= TOOL_RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n\n[... ${text.length - TOOL_RESULT_MAX_CHARS} more characters truncated; omitted evidence does not prove success]\n[Path/artifact references from full evidence]\n${references(text)}`;

/** Serialize model messages to bounded plain text for summarization prompts. */
export function serializeConversation(
  messages: Message[],
  options: { abandonedToolCallIds?: readonly string[] } = {},
): string {
  const parts: string[] = [];
  const results = new Map(
    messages
      .filter((m) => m.role === "toolResult")
      .map((m) => [m.toolCallId, m]),
  );
  for (const [index, message] of messages.entries()) {
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
          const result = results.get(block.id);
          const closed =
            options.abandonedToolCallIds?.includes(block.id) ||
            messages
              .slice(index + 1)
              .some((m) => m.role === "user" || m.role === "assistant");
          const outcome = result
            ? result.isError
              ? "error"
              : "success"
            : message.stopReason === "error" ||
                message.stopReason === "aborted" ||
                !closed
              ? "unknown"
              : "abandoned (no recorded result on this path)";
          tools.push(
            `id=${block.id} name=${block.name} outcome=${outcome} arguments=(${truncateForSummary(args)})`,
          );
        }
      }
      if (thinking.length)
        parts.push(
          `[Assistant thinking]: ${truncateForSummary(thinking.join("\n"))}`,
        );
      if (text.length)
        parts.push(`[Assistant]: ${truncateForSummary(text.join("\n"))}`);
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
      parts.push(
        `[Tool result id=${message.toolCallId} name=${message.toolName} outcome=${message.isError ? "error" : "success"}]: ${truncateForSummary(content) || "(no text evidence)"}`,
      );
    }
  }
  return parts.join("\n\n");
}
