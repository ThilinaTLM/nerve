import { artifacts, artifactNoticeLines } from "../candidate-artifacts.js";
import { fallbackText, validContentBlocks } from "../fallback.js";
import type {
  CandidateContext,
  ProjectableBlock,
  ProjectionCandidate,
} from "../types.js";

export function gptImageCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const validated = artifacts(context);
  const notice = artifactNoticeLines(validated, "primary_result").join("\n");
  const sourceBlocks = validContentBlocks(context.result) ?? [
    { type: "text" as const, text: fallbackText(context.result) },
  ];
  const blocks: ProjectableBlock[] = [...sourceBlocks];
  if (notice) {
    const textIndex = blocks.findIndex((block) => block.type === "text");
    if (textIndex >= 0) {
      const block = blocks[textIndex];
      if (block?.type === "text") {
        blocks[textIndex] = {
          type: "text",
          text: `${block.text}\n${notice}`,
        };
      }
    } else {
      blocks.unshift({ type: "text", text: notice });
    }
  }
  return { blocks, artifacts: validated };
}
