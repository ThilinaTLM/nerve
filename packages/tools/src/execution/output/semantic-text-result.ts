import type { ToolExecutionResult } from "../execution-context.js";

/** Build a semantic HTTP/API result without pretending it is a process. */
export function buildSemanticTextResult(
  text: string,
  details: Record<string, unknown> = {},
): ToolExecutionResult {
  return {
    content: text,
    contentBlocks: [{ type: "text", text }],
    details,
  };
}
