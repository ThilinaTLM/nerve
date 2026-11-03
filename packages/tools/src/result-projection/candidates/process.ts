import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { artifacts } from "../candidate-artifacts.js";
import { record, string, number } from "../candidate-values.js";

/** Process output keeps its status whole and cuts the output to a tail-biased head/tail view. */
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
  const timedOut = details.timedOut === true || result.timedOut === true;
  const exitCode = number(result.exitCode) ?? number(details.exitCode);
  const status = [
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
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const producerStatusIncluded = details.processStatusIncluded === true;
  const body =
    typeof result.content === "string"
      ? result.content
      : [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
          .filter(Boolean)
          .join("\n\n");
  const fullText = [body, producerStatusIncluded ? undefined : status]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  return {
    blocks: [{ type: "text", text: fullText }],
    ...(producerStatusIncluded
      ? {}
      : { status: [{ type: "text", text: status }] }),
    body,
    artifacts: artifacts(context),
  };
}
