import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolOutputLimitsPayload } from "@nervekit/shared";
import type { ToolExecutionResult } from "../../types.js";
import {
  appendBoundedTextNotice,
  type BoundedTextResult,
  boundText,
  PROCESS_INLINE_MAX_LINE_CHARS,
  textBoundaryDetails,
  textLimitSnapshot,
} from "./output-budget.js";
import {
  formatSize,
  PROCESS_INLINE_MAX_BYTES,
  PROCESS_INLINE_MAX_LINES,
  PROCESS_PREVIEW_EDGE_LINES,
  PROCESS_PREVIEW_EDGE_MAX_BYTES,
  PROCESS_PREVIEW_MAX_LINE_CHARS,
  type TruncationDirection,
  type TruncationResult,
  truncateHead,
  truncateLine,
  truncateTail,
} from "./truncate.js";

export type ProcessStreamResultDetails = {
  bytes: number;
  lines: number;
  displayedBytes: number;
  displayedLines: number;
  truncated: boolean;
  omittedLines: number;
  omittedBytes: number;
  truncatedLines: number;
  direction: TruncationDirection;
  maxLineChars?: number;
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
  dataDir?: string;
  durationMs?: number;
  timedOut?: boolean;
  timeoutKilled?: boolean;
  timeoutMessage?: string;
  contentFooterLines?: string[];
};

export type ProcessTextResultOptions = {
  text: string;
  outputFilePrefix: string;
  exitMessagePrefix: string;
  noOutputText?: string;
  details?: Record<string, unknown>;
  dataDir?: string;
  contentFooterLines?: string[];
};

type OutputStats = {
  bytes: number;
  lines: number;
};

type PreviewSection = {
  title: string;
  text: string;
};

type PreviewResult = {
  text: string;
  omittedLines: number;
  omittedBytes: number;
};

type BuiltStreamResult = ProcessStreamResultDetails & {
  text: string;
};

export async function buildProcessTextResult({
  text,
  outputFilePrefix,
  exitMessagePrefix,
  noOutputText,
  details,
  dataDir,
  contentFooterLines,
}: ProcessTextResultOptions): Promise<ToolExecutionResult> {
  const buffer = Buffer.from(text, "utf8");
  return buildProcessResult({
    stdoutChunks: text.length > 0 ? [buffer] : [],
    stderrChunks: [],
    combinedChunks: text.length > 0 ? [buffer] : [],
    code: 0,
    signal: null,
    outputFilePrefix,
    exitMessagePrefix,
    noOutputText,
    details,
    dataDir,
    contentFooterLines,
  });
}

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
  dataDir,
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
  const combinedStats = outputStats(combined);
  const hasOutput = combined.length > 0;
  const largeOutput = hasOutput && exceedsInlineLimits(combinedStats);
  const boundedCombined = boundProcessInlineText(combined);
  const boundedOutput = hasOutput && boundedCombined.truncated;

  const fullOutputPath = boundedOutput
    ? await writeTranscriptFile({ outputFilePrefix, text: combined, dataDir })
    : undefined;

  const stdoutStream = buildStreamResult({ label: "stdout", text: stdout });
  const stderrStream = buildStreamResult({ label: "stderr", text: stderr });
  const combinedStream = buildStreamResult({
    label: "output",
    text: combined,
    savedTo: fullOutputPath,
  });

  const outputPreview = largeOutput
    ? buildHeadTailPreview(combined)
    : undefined;
  const outputTruncation = outputPreview
    ? previewTruncation(outputPreview)
    : boundedCombined.truncated
      ? textBoundaryDetails(boundedCombined)
      : undefined;

  let content = noOutputText;
  if (hasOutput && outputPreview) {
    content = formatLargeOutputContent({
      exitMessagePrefix,
      fullOutputPath: fullOutputPath ?? "",
      combinedStats,
      stdoutStats: outputStats(stdout),
      stderrStats: outputStats(stderr),
      exitCode,
      signal,
      preview: outputPreview,
    });
  } else if (hasOutput && boundedCombined.truncated) {
    content = formatBoundedOutputContent({
      exitMessagePrefix,
      fullOutputPath: fullOutputPath ?? "",
      combinedStats,
      stdoutStats: outputStats(stdout),
      stderrStats: outputStats(stderr),
      exitCode,
      signal,
      boundedText: appendBoundedTextNotice(boundedCombined, {
        label: "output",
        recoveryHint:
          fullOutputPath !== undefined
            ? `Full output saved to ${fullOutputPath}.`
            : undefined,
      }),
    });
  } else if (hasOutput) {
    content = combined;
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
      truncation: outputTruncation,
      outputLimits: processOutputLimits({
        existing: (details as { outputLimits?: ToolOutputLimitsPayload })
          .outputLimits,
        combined,
        combinedStats,
        boundedCombined,
        outputPreview,
        fullOutputPath,
      }),
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

function processOutputLimits({
  existing,
  combined,
  combinedStats,
  boundedCombined,
  outputPreview,
  fullOutputPath,
}: {
  existing?: ToolOutputLimitsPayload;
  combined: string;
  combinedStats: OutputStats;
  boundedCombined: BoundedTextResult;
  outputPreview?: PreviewResult;
  fullOutputPath?: string;
}): ToolOutputLimitsPayload | undefined {
  const execution = outputPreview
    ? {
        truncated: true,
        direction: "head_tail" as const,
        originalBytes: combinedStats.bytes,
        displayedBytes: Buffer.byteLength(outputPreview.text, "utf8"),
        omittedBytes: outputPreview.omittedBytes,
        originalChars: combined.length,
        displayedChars: outputPreview.text.length,
        omittedChars: Math.max(0, combined.length - outputPreview.text.length),
        originalLines: combinedStats.lines,
        displayedLines: countLines(outputPreview.text),
        omittedLines: outputPreview.omittedLines,
        truncatedLines: 0,
        maxBytes: PROCESS_INLINE_MAX_BYTES,
        maxLines: PROCESS_INLINE_MAX_LINES,
        maxLineChars: PROCESS_INLINE_MAX_LINE_CHARS,
      }
    : boundedCombined.truncated
      ? textLimitSnapshot(boundedCombined)
      : undefined;
  const artifacts = [
    ...(existing?.artifacts ?? []),
    ...(fullOutputPath
      ? [
          {
            kind: "full_output" as const,
            path: fullOutputPath,
            label: "Full output",
            bytes: combinedStats.bytes,
            chars: combined.length,
            lines: combinedStats.lines,
          },
        ]
      : []),
  ];
  if (!execution && artifacts.length === 0 && !existing) return undefined;
  return {
    ...existing,
    execution: execution ?? existing?.execution,
    artifacts: artifacts.length > 0 ? artifacts : existing?.artifacts,
  };
}

function buildStreamResult({
  label,
  text,
  savedTo,
}: {
  label: string;
  text: string;
  savedTo?: string;
}): BuiltStreamResult {
  const stats = outputStats(text);
  const aggregateTruncated = exceedsInlineLimits(stats);
  const bounded = boundProcessInlineText(text);
  const truncated = aggregateTruncated || bounded.truncated;
  const preview = aggregateTruncated ? buildHeadTailPreview(text) : undefined;
  const displayText = preview
    ? renderStreamPreview(label, preview)
    : appendBoundedTextNotice(bounded, { label });
  return {
    text: displayText,
    bytes: stats.bytes,
    lines: stats.lines,
    displayedBytes: Buffer.byteLength(displayText, "utf8"),
    displayedLines: countLines(displayText),
    truncated,
    omittedLines: preview?.omittedLines ?? bounded.omittedLines,
    omittedBytes: preview?.omittedBytes ?? bounded.omittedBytes,
    truncatedLines: preview ? 0 : bounded.truncatedLines,
    direction: preview ? "head_tail" : bounded.direction,
    maxLineChars: truncated ? bounded.maxLineChars : undefined,
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
    truncatedLines: stream.truncatedLines,
    direction: stream.direction,
    maxLineChars: stream.maxLineChars,
    savedTo: stream.savedTo,
  };
}

function outputStats(text: string): OutputStats {
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    lines: countLines(text),
  };
}

function exceedsInlineLimits(stats: OutputStats): boolean {
  return (
    stats.bytes > PROCESS_INLINE_MAX_BYTES ||
    stats.lines > PROCESS_INLINE_MAX_LINES
  );
}

function boundProcessInlineText(text: string) {
  return boundText(text, {
    maxBytes: PROCESS_INLINE_MAX_BYTES,
    maxLines: PROCESS_INLINE_MAX_LINES,
    maxLineChars: PROCESS_INLINE_MAX_LINE_CHARS,
  });
}

function buildHeadTailPreview(text: string): PreviewResult {
  const lines = splitLines(text);
  if (lines.length === 0) {
    return {
      text: "",
      omittedLines: 0,
      omittedBytes: 0,
    };
  }

  const headCount = Math.min(PROCESS_PREVIEW_EDGE_LINES, lines.length);
  const tailStart = Math.max(
    headCount,
    lines.length - PROCESS_PREVIEW_EDGE_LINES,
  );
  const tailLines = tailStart < lines.length ? lines.slice(tailStart) : [];
  const omittedBetweenLines = Math.max(0, tailStart - headCount);
  const sections: PreviewSection[] = [
    {
      title: `first ${formatLineCount(headCount)}`,
      text: formatPreviewSection(lines.slice(0, headCount), "head"),
    },
  ];

  if (tailLines.length > 0) {
    sections.push({
      title: `last ${formatLineCount(tailLines.length)}`,
      text: formatPreviewSection(tailLines, "tail"),
    });
  }

  const previewText = renderPreviewSections(sections, omittedBetweenLines);
  const originalBytes = Buffer.byteLength(text, "utf8");
  const previewBytes = Buffer.byteLength(previewText, "utf8");

  return {
    text: previewText,
    omittedLines: omittedBetweenLines,
    omittedBytes: Math.max(0, originalBytes - previewBytes),
  };
}

function formatPreviewSection(
  lines: string[],
  direction: "head" | "tail",
): string {
  const text = lines.map(truncatePreviewLine).join("\n");
  const truncation =
    direction === "head"
      ? truncateHead(text, {
          maxLines: lines.length,
          maxBytes: PROCESS_PREVIEW_EDGE_MAX_BYTES,
        })
      : truncateTail(text, {
          maxLines: lines.length,
          maxBytes: PROCESS_PREVIEW_EDGE_MAX_BYTES,
        });

  if (!truncation.truncated) return truncation.text;
  const marker = `[preview section truncated: omitted ${formatOmissions(truncation)}]`;
  return direction === "head"
    ? `${truncation.text}\n${marker}`
    : `${marker}\n${truncation.text}`;
}

function truncatePreviewLine(line: string): string {
  return truncateLine(line, PROCESS_PREVIEW_MAX_LINE_CHARS).text;
}

function renderPreviewSections(
  sections: PreviewSection[],
  omittedBetweenLines: number,
): string {
  return sections
    .map((section, index) => {
      const prefix =
        index > 0 && omittedBetweenLines > 0
          ? `[... omitted ${formatLineCount(omittedBetweenLines)} between preview sections ...]\n\n`
          : "";
      return `${prefix}Preview — ${section.title}:\n${section.text}`;
    })
    .join("\n\n");
}

function renderStreamPreview(label: string, preview: PreviewResult): string {
  if (preview.text.length === 0) return "";
  return `[${label} exceeded inline limits; showing first/last preview]\n${preview.text}`;
}

function previewTruncation(preview: PreviewResult): TruncationResult {
  return {
    text: preview.text,
    truncated: true,
    omittedLines: preview.omittedLines,
    omittedBytes: preview.omittedBytes,
    direction: "head_tail",
  };
}

function formatLargeOutputContent({
  exitMessagePrefix,
  fullOutputPath,
  combinedStats,
  stdoutStats,
  stderrStats,
  exitCode,
  signal,
  preview,
}: {
  exitMessagePrefix: string;
  fullOutputPath: string;
  combinedStats: OutputStats;
  stdoutStats: OutputStats;
  stderrStats: OutputStats;
  exitCode: number;
  signal: NodeJS.Signals | null;
  preview: PreviewResult;
}): string {
  const lines = [
    `${exitMessagePrefix} output exceeded inline limits and was saved to:`,
    fullOutputPath,
    "",
    `Combined output: ${formatStats(combinedStats)}`,
    `stdout: ${formatStats(stdoutStats)}`,
    `stderr: ${formatStats(stderrStats)}`,
    `exitCode: ${exitCode}${signal ? `, signal: ${signal}` : ""}`,
    "",
    preview.text,
    "",
    "Use read with offset/limit or grep on the saved transcript to inspect specific sections.",
  ];
  return lines.join("\n");
}

function formatBoundedOutputContent({
  exitMessagePrefix,
  fullOutputPath,
  combinedStats,
  stdoutStats,
  stderrStats,
  exitCode,
  signal,
  boundedText,
}: {
  exitMessagePrefix: string;
  fullOutputPath: string;
  combinedStats: OutputStats;
  stdoutStats: OutputStats;
  stderrStats: OutputStats;
  exitCode: number;
  signal: NodeJS.Signals | null;
  boundedText: string;
}): string {
  const lines = [
    `${exitMessagePrefix} output contained overlong lines and was saved to:`,
    fullOutputPath,
    "",
    `Combined output: ${formatStats(combinedStats)}`,
    `stdout: ${formatStats(stdoutStats)}`,
    `stderr: ${formatStats(stderrStats)}`,
    `exitCode: ${exitCode}${signal ? `, signal: ${signal}` : ""}`,
    "",
    boundedText,
    "",
    "Use read with byteOffset/byteLimit, offset/limit, or grep on the saved transcript to inspect omitted content.",
  ];
  return lines.join("\n");
}

async function writeTranscriptFile({
  outputFilePrefix,
  text,
  dataDir,
}: {
  outputFilePrefix: string;
  text: string;
  dataDir?: string;
}): Promise<string> {
  const baseDir = dataDir
    ? join(dataDir, "tmp", "tool-outputs")
    : join(tmpdir(), "nerve-tool-outputs");
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(
    baseDir,
    `${outputFilePrefix}-${timestamp}-${randomUUID()}.log`,
  );
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  return path;
}

function formatStats(stats: OutputStats): string {
  return `${formatSize(stats.bytes)}, ${formatLineCount(stats.lines)}`;
}

function formatLineCount(lines: number): string {
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

function formatOmissions(truncation: TruncationResult): string {
  const parts: string[] = [];
  if (truncation.omittedLines > 0) {
    parts.push(formatLineCount(truncation.omittedLines));
  }
  if (truncation.omittedBytes > 0) {
    parts.push(formatSize(truncation.omittedBytes));
  }
  return parts.length > 0 ? parts.join(", ") : "0 bytes";
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutFinalNewline.length === 0
    ? [""]
    : withoutFinalNewline.split("\n");
}

function countLines(text: string): number {
  return splitLines(text).length;
}
