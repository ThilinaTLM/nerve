import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionResult } from "../../types.js";
import { formatSize, type TruncationResult, truncateTail } from "./truncate.js";

export type ProcessStreamResultDetails = {
  bytes: number;
  lines: number;
  displayedBytes: number;
  displayedLines: number;
  truncated: boolean;
  omittedLines: number;
  omittedBytes: number;
  direction: TruncationResult["direction"];
  savedTo?: string;
};

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
  durationMs?: number;
  timedOut?: boolean;
  timeoutKilled?: boolean;
  timeoutMessage?: string;
  contentFooterLines?: string[];
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
  durationMs,
  timedOut = false,
  timeoutKilled = false,
  timeoutMessage,
  contentFooterLines = [],
}: ProcessResultOptions): Promise<ToolExecutionResult> {
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const combined = Buffer.concat(combinedChunks).toString("utf8");
  const exitCode = code ?? (timedOut ? 124 : signal ? 128 : 0);

  const stdoutStream = await buildStreamResult({
    label: "stdout",
    text: stdout,
    outputFilePrefix,
  });
  const stderrStream = await buildStreamResult({
    label: "stderr",
    text: stderr,
    outputFilePrefix,
  });
  const combinedStream = await buildStreamResult({
    label: "output",
    text: combined,
    outputFilePrefix,
  });

  const displayOutput = combined.length > 0 ? combined : noOutputText;
  const outputTruncation = truncateTail(displayOutput);
  let content = outputTruncation.text;
  let fullOutputPath: string | undefined;
  const contentHeaders: string[] = [];

  if (outputTruncation.truncated) {
    fullOutputPath =
      combinedStream.savedTo ??
      (await writeTempOutputFile({
        outputFilePrefix,
        label: "output",
        text: displayOutput,
      }));
    contentHeaders.push(
      `[output truncated: showing tail; omitted ${formatOmissions(outputTruncation)}; full output saved to ${fullOutputPath}]`,
    );
  }

  for (const [label, stream] of [
    ["stdout", stdoutStream] as const,
    ["stderr", stderrStream] as const,
  ]) {
    if (!stream.truncated || !stream.savedTo) continue;
    contentHeaders.push(
      `[${label} truncated: showing tail; omitted ${formatStreamOmissions(stream)}; full ${label} saved to ${stream.savedTo}]`,
    );
  }

  if (contentHeaders.length > 0) {
    content = `${contentHeaders.join("\n")}\n${content}`;
  }

  const footerLines = [...contentFooterLines];
  if (timedOut) {
    footerLines.push(
      timeoutMessage ??
        `${exitMessagePrefix} timed out and ${timeoutKilled ? "was killed" : "was not killed"}.`,
    );
  }
  if (exitCode !== 0) {
    footerLines.push(`${exitMessagePrefix} exited with code ${exitCode}.`);
  }
  if (footerLines.length > 0) {
    content += `${content.endsWith("\n") ? "" : "\n"}${footerLines.join("\n")}`;
  }

  return {
    stdout: stdoutStream.text,
    stderr: stderrStream.text,
    exitCode,
    content,
    contentBlocks: [{ type: "text", text: content }],
    details: {
      ...details,
      exitCode,
      durationMs,
      timedOut,
      timeoutKilled,
      truncation: outputTruncation.truncated ? outputTruncation : undefined,
      streams: {
        stdout: streamDetails(stdoutStream),
        stderr: streamDetails(stderrStream),
        combined: streamDetails(combinedStream),
      },
      fullOutputPath,
      signal,
    },
  };
}

type BuiltStreamResult = ProcessStreamResultDetails & {
  text: string;
};

async function buildStreamResult({
  label,
  text,
  outputFilePrefix,
}: {
  label: string;
  text: string;
  outputFilePrefix: string;
}): Promise<BuiltStreamResult> {
  const truncated = truncateTail(text);
  const savedTo = truncated.truncated
    ? await writeTempOutputFile({ outputFilePrefix, label, text })
    : undefined;
  return {
    text: truncated.text,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: countLines(text),
    displayedBytes: Buffer.byteLength(truncated.text, "utf8"),
    displayedLines: countLines(truncated.text),
    truncated: truncated.truncated,
    omittedLines: truncated.omittedLines,
    omittedBytes: truncated.omittedBytes,
    direction: truncated.direction,
    savedTo,
  };
}

function streamDetails(stream: BuiltStreamResult): ProcessStreamResultDetails {
  return {
    bytes: stream.bytes,
    lines: stream.lines,
    displayedBytes: stream.displayedBytes,
    displayedLines: stream.displayedLines,
    truncated: stream.truncated,
    omittedLines: stream.omittedLines,
    omittedBytes: stream.omittedBytes,
    direction: stream.direction,
    savedTo: stream.savedTo,
  };
}

async function writeTempOutputFile({
  outputFilePrefix,
  label,
  text,
}: {
  outputFilePrefix: string;
  label: string;
  text: string;
}): Promise<string> {
  const path = join(
    tmpdir(),
    `${outputFilePrefix}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`,
  );
  await writeFile(path, text, "utf8");
  return path;
}

function formatOmissions(truncation: TruncationResult): string {
  const parts: string[] = [];
  if (truncation.omittedLines > 0) {
    parts.push(
      `${truncation.omittedLines} line${truncation.omittedLines === 1 ? "" : "s"}`,
    );
  }
  if (truncation.omittedBytes > 0) {
    parts.push(formatSize(truncation.omittedBytes));
  }
  return parts.length > 0 ? parts.join(", ") : "0 bytes";
}

function formatStreamOmissions(stream: ProcessStreamResultDetails): string {
  const parts: string[] = [];
  if (stream.omittedLines > 0) {
    parts.push(
      `${stream.omittedLines} line${stream.omittedLines === 1 ? "" : "s"}`,
    );
  }
  if (stream.omittedBytes > 0) parts.push(formatSize(stream.omittedBytes));
  return parts.length > 0 ? parts.join(", ") : "0 bytes";
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}
