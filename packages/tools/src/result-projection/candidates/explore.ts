import type { CandidateContext, ProjectionCandidate } from "../types.js";
import { textCandidate } from "./text.js";
import { artifacts } from "../candidate-artifacts.js";
import { semanticSummary } from "../candidate-semantic-text.js";
import { record, array, string, firstString } from "../candidate-values.js";

export function exploreCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const reports =
    array(result.reports) ?? array(record(result.details).reports);
  if (!reports) return textCandidate(context);
  return {
    blocks: [
      {
        type: "text",
        text: reports
          .map((report, index) => semanticSummary(report, index + 1))
          .join("\n\n"),
      },
    ],
    tasks: reports.map((report, index) => {
      const value = record(report);
      const text =
        firstString(value.report, value.content, value.summary) ??
        semanticSummary(report, index + 1);
      const heading = `Task ${index + 1}${typeof value.label === "string" ? ` — ${value.label}` : ""}: ${string(value.status) || "completed"}`;
      const reportPath = string(value.reportPath);
      const metadata = reportPath
        ? `Report: ${reportPath}${value.reportBytes !== undefined ? ` (${String(value.reportBytes)} bytes, ${String(value.reportLines ?? "?")} lines)` : ""}`
        : "";
      const preview =
        firstString(value.summaryPreview) ?? "No summary was provided.";
      return {
        index,
        candidate: {
          blocks: [
            {
              type: "text",
              text: [heading, text, metadata].filter(Boolean).join("\n"),
            },
          ],
          status: [
            {
              type: "text",
              text: [heading, preview, metadata].filter(Boolean).join("\n"),
            },
          ],
          artifacts: artifacts(context).filter(
            (artifact) =>
              artifact.id === String(value.artifactId) ||
              artifact.label.includes(string(value.label)),
          ),
        },
      };
    }),
    artifacts: artifacts(context),
  };
}
