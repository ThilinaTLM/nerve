import { CompactionError } from "../errors.js";

export const REQUIRED_SUMMARY_HEADINGS = [
  "Goal",
  "Requirements and Constraints",
  "Work Completed",
  "Work Remaining",
  "Key Decisions",
  "Current Working State",
  "Continuation Plan",
  "Critical References",
] as const;

/** Text budget and completion budget differ because completion may include reasoning. */
export function summaryBudget(reserveTokens: number, modelMaxTokens?: number) {
  if (
    !Number.isFinite(reserveTokens) ||
    reserveTokens <= 0 ||
    (modelMaxTokens !== undefined && !Number.isFinite(modelMaxTokens))
  ) {
    throw new CompactionError(
      "summarization_failed",
      "Invalid compaction summary budget.",
    );
  }
  const completionTokens = Math.min(
    Math.floor(reserveTokens * 0.8),
    modelMaxTokens && modelMaxTokens > 0
      ? Math.floor(modelMaxTokens)
      : Number.MAX_SAFE_INTEGER,
  );
  const ceiling = Math.min(4_000, completionTokens);
  if (ceiling < 512)
    throw new CompactionError(
      "summarization_failed",
      "Compaction summary budget is too small.",
    );
  return { target: Math.min(3_000, ceiling), ceiling, completionTokens };
}

/** Structural checks cannot establish semantic fidelity, but reject unsafe drafts. */
export function summaryDefects(
  text: string,
  ceiling: number,
  stopReason?: string,
): string[] {
  const defects: string[] = [];
  if (!text.trim()) defects.push("empty checkpoint");
  if (stopReason === "length") defects.push("completion was truncated");
  if (Math.ceil(text.length / 4) > ceiling)
    defects.push(`exceeds ${ceiling} estimated text tokens`);
  // Keep heading capture on one line. Overlapping .+ and \s* quantifiers
  // permit polynomial backtracking on untrusted model output.
  const headings = [...text.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  if (
    headings.length !== REQUIRED_SUMMARY_HEADINGS.length ||
    headings.some(
      (match, index) => match[1].trim() !== REQUIRED_SUMMARY_HEADINGS[index],
    )
  ) {
    defects.push("use each required heading exactly once, in order");
  }
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i][0].length;
    const end = headings[i + 1]?.index ?? text.length;
    if (!text.slice(start, end).trim())
      defects.push(`empty section at position ${i + 1}`);
  }
  return defects;
}
