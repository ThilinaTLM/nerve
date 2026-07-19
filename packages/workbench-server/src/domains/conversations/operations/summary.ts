import {
  type AgentMessage,
  convertToLlm,
  serializeConversation,
} from "@nervekit/host-runtime/harness";

export { deriveConversationTitle } from "@nervekit/contracts";

export interface ExtractiveSummaryInput {
  title: string;
  messages: AgentMessage[];
  previousSummary?: string;
  instructions?: string;
  /** Optional hard output bound used for context compaction fallbacks. */
  maxChars?: number;
}

export function buildExtractiveSummary(input: ExtractiveSummaryInput): string {
  const llmMessages = convertToLlm(input.messages);
  const serialized = serializeConversation(llmMessages).trim();
  const maxChars = input.maxChars
    ? Math.max(1_000, Math.floor(input.maxChars))
    : undefined;
  const excerpt = truncateText(
    serialized || "No message text was available.",
    Math.min(12_000, maxChars ? Math.max(1_000, maxChars - 2_000) : 12_000),
  );
  const userMessages = llmMessages.filter((message) => message.role === "user");
  const assistantMessages = llmMessages.filter(
    (message) => message.role === "assistant",
  );
  const sections = [
    `## ${input.title}`,
    "",
    "Generated locally by the orchestrator from the conversation branch. Treat this as a context checkpoint, not a new user request.",
    "",
  ];
  if (input.instructions?.trim()) {
    sections.push("## Operator instructions", input.instructions.trim(), "");
  }
  if (input.previousSummary?.trim()) {
    sections.push(
      "## Previous checkpoint",
      truncateText(
        input.previousSummary.trim(),
        Math.min(
          4_000,
          maxChars ? Math.max(500, Math.floor(maxChars * 0.25)) : 4_000,
        ),
      ),
      "",
    );
  }
  sections.push(
    "## Coverage",
    `- User messages summarized: ${userMessages.length}`,
    `- Assistant messages summarized: ${assistantMessages.length}`,
    `- Total messages summarized: ${llmMessages.length}`,
    "",
    "## Conversation excerpt",
    excerpt,
  );
  const summary = sections.join("\n");
  return maxChars ? truncateText(summary, maxChars) : summary;
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[…${text.length - maxChars} more characters truncated]`;
}
