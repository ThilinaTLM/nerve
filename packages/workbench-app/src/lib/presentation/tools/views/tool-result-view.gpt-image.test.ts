import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { toolCall } from "./tool-result-view.fixtures";

describe("parseToolView gpt_image", () => {
  it("projects generated image blocks and artifact paths", () => {
    const view = parseToolView(
      toolCall(
        "gpt_image",
        { prompt: "A coral nerve cell" },
        {
          content: "Generated 1 image with gpt-image-2.5-flare.",
          contentBlocks: [
            { type: "text", text: "Generated image" },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
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
    assert.equal(view.model, "gpt-image-2.5-flare");
    assert.equal(view.prompt, "A coral nerve cell");
    assert.deepEqual(view.images, [
      {
        dataUrl: "data:image/png;base64,aW1hZ2U=",
        mimeType: "image/png",
        path: "/tmp/generated-1.png",
        byteSize: 5,
      },
    ]);
  });

  it("keeps file details when transcript previews omit image bytes", () => {
    const view = parseToolView(
      toolCall(
        "gpt_image",
        { prompt: "A coral nerve cell" },
        {
          content: "Generated 1 image with gpt-image-2.5-flare.",
          contentBlocks: [
            {
              type: "text",
              text: "[Image omitted from transcript preview.]",
            },
          ],
          details: {
            model: "gpt-image-2.5-flare",
            images: [
              {
                path: "/tmp/generated-1.png",
                mimeType: "image/png",
                byteSize: 2048,
                revisedPrompt: "A detailed coral nerve cell",
              },
            ],
          },
        },
      ),
    );

    assert.equal(view.kind, "gpt_image");
    if (view.kind !== "gpt_image") return;
    assert.deepEqual(view.images, [
      {
        mimeType: "image/png",
        path: "/tmp/generated-1.png",
        byteSize: 2048,
        revisedPrompt: "A detailed coral nerve cell",
      },
    ]);
  });
});
