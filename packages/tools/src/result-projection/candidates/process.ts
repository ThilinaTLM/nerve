import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { processFooter } from "../process-footer.js";
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
  const status = processFooter({
    exitCode,
    signal:
      typeof result.signal === "string"
        ? result.signal
        : typeof details.signal === "string"
          ? details.signal
          : undefined,
    timedOut,
    durationMs: number(details.durationMs),
  });
  const producerStatusIncluded = details.processStatusIncluded === true;
  const body =
    typeof result.content === "string"
      ? result.content
      : [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
          .filter(Boolean)
          .join("\n\n");
  const fullText = [body, producerStatusIncluded ? undefined : status]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  return {
    blocks: [{ type: "text", text: fullText }],
    ...(producerStatusIncluded
      ? {}
      : { status: [{ type: "text", text: status }] }),
    body,
    artifacts: artifacts(context),
  };
}
