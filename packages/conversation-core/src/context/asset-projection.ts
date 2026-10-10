import type { ConversationEvent, ModelContent } from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import {
  selectContextEvents,
  type ProjectionOptions,
} from "./context-projection.js";

/** Inline only images explicitly present in a tool's agent projection. */
export async function loadProjectionOptions(
  path: ConversationEvent[],
  assets: AssetStore,
): Promise<ProjectionOptions> {
  const images = new Map<string, string>();
  for (const event of selectContextEvents(path).events) {
    if (
      event.type !== "tool_call_response" ||
      event.llmRepresentation === "none"
    )
      continue;
    for (const block of event.payload.agentProjection) {
      if (block.type === "image" && !images.has(block.assetId))
        images.set(
          block.assetId,
          (await assets.read(block.assetId)).toString("base64"),
        );
    }
  }
  return {
    resolveAgentProjection: (projection): ModelContent =>
      projection.map((block) =>
        block.type === "text"
          ? block
          : {
              type: "image",
              mimeType: block.mimeType,
              data: images.get(block.assetId)!,
            },
      ),
  };
}
