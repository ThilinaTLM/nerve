import {
  type AgentMessage,
  convertToLlm,
  serializeConversation,
} from "@nervekit/agent-runtime";

export { deriveConversationTitle } from "@nervekit/contracts";

export interface ExtractiveSummaryInput {
  title: string;
  messages: AgentMessage[];
  previousSummary?: string;
  instructions?: string;
}

export function buildExtractiveSummary(input: ExtractiveSummaryInput): string {
  const llmMessages = convertToLlm(input.messages);
  const serialized = serializeConversation(llmMessages).trim();
  const excerpt = truncateText(
    serialized || "No message text was available.",
    12_000,
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
      truncateText(input.previousSummary.trim(), 4_000),
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
  return sections.join("\n");
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[…${text.length - maxChars} more characters truncated]`;
}
