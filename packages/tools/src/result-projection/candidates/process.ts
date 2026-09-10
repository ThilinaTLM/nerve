import type {
  CandidateContext,
  ProjectionCandidate,
  SemanticItem,
} from "../types.js";
import { artifacts } from "../candidate-artifacts.js";
import { count, record, string, number } from "../candidate-values.js";

export function processCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  if (
    typeof result.stdout !== "string" &&
    typeof result.stderr !== "string" &&
    typeof result.content !== "string"
  )
    return;
  const stdout = string(result.stdout);
  const stderr = string(result.stderr);
  const details = record(result.details);
  const streams = record(details.streams);
  const combined = record(streams.combined);
  const timedOut = details.timedOut === true || result.timedOut === true;
  const exitCode = number(result.exitCode) ?? number(details.exitCode);
  const basicStatus = [
    `Process ${exitCode === undefined ? "finished" : `exit code ${String(exitCode)}`}.`,
    typeof result.signal === "string"
      ? `Signal: ${result.signal}`
      : typeof details.signal === "string"
        ? `Signal: ${details.signal}`
        : undefined,
    timedOut ? "Timed out: yes" : undefined,
    number(details.durationMs) !== undefined
      ? `Duration: ${String(details.durationMs)} ms`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const outputFacts = [
    number(combined.lines) !== undefined
      ? `Output lines: ${String(combined.lines)}`
      : undefined,
    number(combined.bytes) !== undefined
      ? `Output bytes: ${String(combined.bytes)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const producerStatusIncluded = details.processStatusIncluded === true;
  const body =
    typeof result.content === "string"
      ? result.content
      : [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
          .filter(Boolean)
          .join("\n\n");
  const fullText = [
    body,
    producerStatusIncluded ? undefined : basicStatus.join("\n"),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const diagnosticLines = diagnosticItems(stdout, stderr, exitCode, timedOut);
  return {
    blocks: [{ type: "text", text: fullText }],
    status: [
      { type: "text", text: [...basicStatus, ...outputFacts].join("\n") },
    ],
    items: diagnosticLines,
    overflow: { noun: "diagnostic line" },
    counts:
      number(combined.lines) !== undefined
        ? [count("event", number(combined.lines)!, diagnosticLines.length)]
        : undefined,
    artifacts: artifacts(context),
  };
}

function diagnosticItems(
  stdout: string,
  stderr: string,
  exitCode: unknown,
  timedOut: boolean,
): SemanticItem[] {
  const all = [
    ...stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ stream: "stdout", line })),
    ...stderr
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ stream: "stderr", line })),
  ];
  const diagnostic = all.filter(({ line }) =>
    /\b(error|warn(?:ing)?|fatal|fail(?:ed|ure)?|exception|traceback|timeout|timed out)\b/i.test(
      line,
    ),
  );
  const selected = (
    diagnostic.length > 0 ? diagnostic : exitCode !== 0 || timedOut ? all : []
  ).slice(-8);
  return selected.map(({ stream, line }, index) => ({
    id: String(index),
    countsAs: "event",
    blocks: [{ type: "text", text: `[${stream}] ${line}` }],
  }));
}
