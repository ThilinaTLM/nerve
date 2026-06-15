import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionResult } from "../../types.js";
import { truncateTail } from "./truncate.js";

export type ProcessResultOptions = {
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
  combinedChunks: Buffer[];
  code: number | null;
  signal: NodeJS.Signals | null;
  outputFilePrefix: string;
  exitMessagePrefix: string;
  noOutputText?: string;
  details?: Record<string, unknown>;
};

export async function buildProcessResult({
  stdoutChunks,
  stderrChunks,
  combinedChunks,
  code,
  signal,
  outputFilePrefix,
  exitMessagePrefix,
  noOutputText = "(no output)",
  details = {},
}: ProcessResultOptions): Promise<ToolExecutionResult> {
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const combined = Buffer.concat(combinedChunks).toString("utf8");
  const exitCode = code ?? (signal ? 128 : 0);
  const output = combined.length > 0 ? combined : noOutputText;
  const truncated = truncateTail(output);
  let content = truncated.text;
  let fullOutputPath: string | undefined;
  if (truncated.truncated) {
    fullOutputPath = join(
      tmpdir(),
      `${outputFilePrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`,
    );
    await writeFile(fullOutputPath, output, "utf8");
    content = `[...output truncated; full output saved to ${fullOutputPath}]\n${content}`;
  }
  if (exitCode !== 0) {
    content += `${content.endsWith("\n") ? "" : "\n"}${exitMessagePrefix} exited with code ${exitCode}.`;
  }
  return {
    stdout,
    stderr,
    exitCode,
    content,
    contentBlocks: [{ type: "text", text: content }],
    details: {
      ...details,
      truncation: truncated.truncated ? truncated : undefined,
      fullOutputPath,
      signal,
    },
  };
}
