import {
  asRecord,
  parseToolExecutionResult,
  stringField,
} from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

type GptImageView = Extract<ToolView, { kind: "gpt_image" }>;

export function parseGptImageView(
  rawArgs: unknown,
  rawResult: unknown,
): GptImageView {
  const args = asRecord(rawArgs);
  const result = parseToolExecutionResult(rawResult);
  const details = asRecord(result?.details);
  const paths = (Array.isArray(details.images) ? details.images : [])
    .map((image) => stringField(asRecord(image).path))
    .filter((path): path is string => Boolean(path));
  return {
    kind: "gpt_image",
    prompt: stringField(args.prompt),
    paths,
  };
}
