import {
  findExecutableCommandBlocks,
  formatInlineCommandResultText,
  replaceExecutableCommandBlocks,
} from "@nervekit/contracts/completions";
import type { CommandPreparation } from "@nervekit/contracts/core";
import type { ProcessPort } from "../ports.js";

export function initialCommandPreparation(
  text: string,
): CommandPreparation | null {
  const blocks = findExecutableCommandBlocks(text);
  return blocks.length
    ? {
        blocks: blocks.map((block, index) => ({
          index,
          command: block.command,
          state: "not_started",
          result: null,
        })),
      }
    : null;
}

/** The caller fences saves against cancellation/removal of the queued input. */
export async function prepareCommands(input: {
  text: string;
  preparation: CommandPreparation;
  cwd: string;
  signal: AbortSignal;
  processes: ProcessPort;
  save(preparation: CommandPreparation, preparedText?: string): boolean;
}): Promise<void> {
  const { preparation, signal } = input;
  let interrupted = false;
  for (const block of preparation.blocks) {
    if (signal.aborted) return;
    if (block.state === "running") block.state = "indeterminate";
    if (block.state === "not_started") {
      if (interrupted) {
        block.state = "not_run";
      } else {
        block.state = "running";
        if (!input.save(preparation)) return;
        try {
          block.result = await input.processes.run({
            command: block.command,
            cwd: input.cwd,
            signal,
          });
          block.state = signal.aborted ? "cancelled" : "completed";
        } catch {
          // A thrown error cannot prove that external effects did not occur.
          block.state = signal.aborted ? "cancelled" : "indeterminate";
        }
      }
    }
    interrupted ||= ["cancelled", "indeterminate", "not_run"].includes(
      block.state,
    );
    if (signal.aborted || !input.save(preparation)) return;
  }
  const blocks = findExecutableCommandBlocks(input.text);
  const preparedText = replaceExecutableCommandBlocks(
    input.text,
    preparation.blocks.map((block) => ({
      block: blocks[block.index],
      text: formatInlineCommandResultText({
        command: block.command,
        status: block.state,
        ...(block.result?.exitCode != null
          ? { exitCode: block.result.exitCode }
          : {}),
        output: block.result
          ? [block.result.stdout, block.result.stderr]
              .filter(Boolean)
              .join("\n")
          : block.state === "indeterminate"
            ? "Command outcome could not be confirmed; it was not repeated."
            : "Command not started after interruption.",
      }),
    })),
  );
  input.save(preparation, preparedText);
}
