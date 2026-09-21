import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { toolCall } from "./tool-result-view.fixtures";

describe("parseToolView gpt_image", () => {
  it("projects the generated artifact path without image data", () => {
    const view = parseToolView(
      toolCall(
        "gpt_image",
        { prompt: "A coral nerve cell" },
        {
          content: "Generated 1 image with gpt-image-2.5-flare.",
          contentBlocks: [
            {
              type: "text",
              text: "Generated 1 image with gpt-image-2.5-flare.",
            },
          ],
          details: {
            model: "gpt-image-2.5-flare",
            images: [
              {
                path: "/tmp/generated-1.png",
                mimeType: "image/png",
                byteSize: 5,
              },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "gpt_image");
    if (view.kind !== "gpt_image") return;
    assert.equal(view.prompt, "A coral nerve cell");
    assert.deepEqual(view.paths, ["/tmp/generated-1.png"]);
  });
});
