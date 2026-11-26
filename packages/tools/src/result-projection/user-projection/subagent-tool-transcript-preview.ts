import {
  firstLines,
  PREVIEW_COUNT,
  type Preview,
} from "./transcript-text-preview.js";

/** `subagent_prompt` accepts up to 10 assignments. */
export const SUBAGENT_PROMPT_MAX_ASSIGNMENTS = 10;
/** Head of each prompt and of the shared context kept in the preview. */
const SUBAGENT_PROMPT_TEXT_CHARS = 1000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Names and profiles first, then the bounded prompt head of each assignment. */
export function subagentPromptArgsPreview(args: Record<string, unknown>): {
  value: Record<string, unknown>;
  texts: Array<Preview<string | undefined>>;
} {
  const texts: Array<Preview<string | undefined>> = [];
  const head = (value: unknown) => {
    const preview = firstLines(
      typeof value === "string" ? value : undefined,
      PREVIEW_COUNT,
      SUBAGENT_PROMPT_TEXT_CHARS,
    );
    texts.push(preview);
    return preview.value;
  };
  const assignments = Array.isArray(args.assignments)
    ? args.assignments.map((entry) => {
        const { name, profile, prompt, ...rest } = record(entry);
        return { name, profile, ...rest, prompt: head(prompt) };
      })
    : undefined;
  const { context, ...rest } = args;
  return {
    value: {
      ...rest,
      ...(assignments ? { assignments } : {}),
      ...(context !== undefined ? { context: head(context) } : {}),
    },
    texts,
  };
}
