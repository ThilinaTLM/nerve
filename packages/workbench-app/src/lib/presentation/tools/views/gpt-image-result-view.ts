import {
  asRecord,
  imageDataUrl,
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
  const imageDetails = arrayField(details.images).map(asRecord);
  const imageBlocks =
    result?.contentBlocks?.filter((block) => block.type === "image") ?? [];
  const images: GptImageView["images"] = Array.from(
    { length: Math.max(imageBlocks.length, imageDetails.length) },
    (_, index): GptImageView["images"][number] => {
      const block = imageBlocks[index];
      const image = imageDetails[index];
      return {
        ...(block?.type === "image"
          ? {
              dataUrl: imageDataUrl(block.mimeType, block.data),
              mimeType: block.mimeType,
            }
          : { mimeType: stringField(image?.mimeType) }),
        ...(stringField(image?.path) ? { path: stringField(image?.path) } : {}),
        ...(typeof image?.byteSize === "number"
          ? { byteSize: image.byteSize }
          : {}),
        ...(stringField(image?.revisedPrompt)
          ? { revisedPrompt: stringField(image?.revisedPrompt) }
          : {}),
      };
    },
  ).filter((image) => image.dataUrl || image.path);
  return {
    kind: "gpt_image",
    prompt: stringField(args.prompt),
    model: stringField(details.model),
    images,
  };
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
