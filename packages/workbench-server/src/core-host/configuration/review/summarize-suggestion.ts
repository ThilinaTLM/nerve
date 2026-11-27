import type { PromptSuggestionDefinition } from "../../../domains/prompt-suggestions/prompt-suggestion-types.js";
import { summarizeWhen } from "../../../domains/prompt-suggestions/prompt-suggestion-summary.js";
import { line, type ReviewLine } from "./review-lines.js";

const PROMPT_MAX = 120;

/** The lines of a prompt suggestion file: the script that decides when it shows, what it offers, when it appears. */
export function suggestionLines(
  definition: PromptSuggestionDefinition,
  scope: "user" | "project",
): ReviewLine[] {
  const lines: ReviewLine[] = [];
  if (definition.enableJs)
    lines.push(
      line("Runs a script to decide when it shows", true, "Runs a script"),
    );
  const prompt = definition.prompt.replace(/\s+/g, " ").trim();
  lines.push(
    line(
      `Offers “${definition.label}”: ${
        prompt.length > PROMPT_MAX
          ? `${prompt.slice(0, PROMPT_MAX - 1).trimEnd()}…`
          : prompt
      }`,
      false,
      "Offers a prompt",
    ),
  );
  const when = summarizeWhen(definition.when, false);
  lines.push(
    line(
      `${when.replace(/\.$/, "")} ${scope === "user" ? "in every project" : "in this project"}`,
      false,
      when === "Always appears." ? "Always appears" : "Appears on a condition",
    ),
  );
  return lines;
}
