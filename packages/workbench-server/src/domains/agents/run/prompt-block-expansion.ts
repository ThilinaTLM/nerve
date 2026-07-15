import type { ToolExecutionResult } from "@nervekit/host-runtime/tools";
import {
  findExecutableCommandBlocks,
  type PromptRequest,
  replaceExecutableCommandBlocks,
} from "@nervekit/contracts";
import { inlineCommandExecutionResultText } from "./inline-command-results.js";

export type PromptBlockCommandExecutor = (
  command: string,
  options: { signal?: AbortSignal },
) => Promise<ToolExecutionResult>;

/**
 * Execute every `!!!` fenced command block in a user prompt and replace each
 * block with its formatted result before the prompt reaches the model.
 * Blocks run sequentially; an abort between blocks stops the expansion.
 */
export async function expandExecutablePromptBlocks(
  execute: PromptBlockCommandExecutor,
  request: PromptRequest,
  signal: AbortSignal,
): Promise<PromptRequest> {
  const blocks = findExecutableCommandBlocks(request.text);
  if (blocks.length === 0) return request;
  const replacements = [];
  for (const block of blocks) {
    if (signal.aborted) throw new Error("Command execution aborted.");
    const result = await execute(block.command, { signal });
    replacements.push({
      block,
      text: inlineCommandExecutionResultText(block.command, result),
    });
  }
  return {
    ...request,
    text: replaceExecutableCommandBlocks(request.text, replacements),
  };
}
