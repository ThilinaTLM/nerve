import {
  asRecord,
  parseToolExecutionResult,
  stringField,
} from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

type GenerateImageView = Extract<ToolView, { kind: "generate_image" }>;

export function parseGenerateImageView(
  rawArgs: unknown,
  rawResult: unknown,
): GenerateImageView {
  const args = asRecord(rawArgs);
  const result = parseToolExecutionResult(rawResult);
  const details = asRecord(result?.details);
  const paths = (Array.isArray(details.images) ? details.images : [])
    .map((image) => stringField(asRecord(image).path))
    .filter((path): path is string => Boolean(path));
  return {
    kind: "generate_image",
    prompt: stringField(args.prompt),
    paths,
  };
}
