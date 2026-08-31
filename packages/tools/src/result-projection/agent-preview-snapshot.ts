import type { AgentPreviewSnapshot } from "@nervekit/contracts/tools";
import { createHash } from "node:crypto";
import type { ProjectableBlock } from "./types.js";

/** Persist the exact model projection without duplicating image payload bytes. */
export function snapshotAgentPreview(
  blocks: readonly ProjectableBlock[],
  result: unknown,
): AgentPreviewSnapshot {
  const resultBlocks = contentBlocks(result);
  return {
    version: 1,
    blocks: blocks.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      const resultContentBlockIndex = resultBlocks.findIndex(
        (candidate) =>
          candidate.type === "image" &&
          candidate.mimeType === block.mimeType &&
          candidate.data === block.data,
      );
      if (resultContentBlockIndex < 0) {
        throw new Error(
          "Agent preview image does not reference a tool-result content block.",
        );
      }
      const bytes = Buffer.from(block.data, "base64");
      return {
        type: "image",
        mimeType: block.mimeType,
        byteLength: bytes.byteLength,
        digest: createHash("sha256").update(bytes).digest("hex"),
        resultContentBlockIndex,
      };
    }),
  };
}

function contentBlocks(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const blocks = (result as Record<string, unknown>).contentBlocks;
  return Array.isArray(blocks)
    ? blocks.filter(
        (block): block is Record<string, unknown> =>
          Boolean(block) && typeof block === "object" && !Array.isArray(block),
      )
    : [];
}
