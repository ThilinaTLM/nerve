import type { ToolExecutionResult } from "../../execution/execution-context.js";

export function contentResult(
  content: string,
  details?: unknown,
): ToolExecutionResult {
  return { content, details };
}

export function boundedSummary(text: string, maxChars = 24_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n\n[Output truncated; inspect the durable host record for full details.]`;
}
