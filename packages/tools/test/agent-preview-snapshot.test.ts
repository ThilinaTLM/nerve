import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { snapshotAgentPreview } from "../src/index.js";

describe("agent preview snapshots", () => {
  it("keeps exact text and references image bytes in the result", () => {
    const image = Buffer.from("image bytes").toString("base64");
    const snapshot = snapshotAgentPreview(
      [
        { type: "text", text: "exact projection" },
        { type: "image", data: image, mimeType: "image/png" },
      ],
      {
        contentBlocks: [
          { type: "text", text: "exact projection" },
          { type: "image", data: image, mimeType: "image/png" },
        ],
      },
    );
    assert.deepEqual(snapshot.blocks[0], {
      type: "text",
      text: "exact projection",
    });
    assert.deepEqual(snapshot.blocks[1], {
      type: "image",
      mimeType: "image/png",
      byteLength: 11,
      digest:
        "de7030234493a8bea844dbe1d8676e68a2c1a4b014c721f0425a22b6df66faec",
      resultContentBlockIndex: 1,
    });
  });

  it("rejects projected images that are not retained in the result", () => {
    assert.throws(
      () =>
        snapshotAgentPreview(
          [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
          {},
        ),
      /does not reference/,
    );
  });
});
