import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentProjectionSchema,
  storedToolResultSchema,
} from "../../src/domains/core/event.js";

describe("stored tool-result image references", () => {
  const image = { type: "image", assetId: "asset_test", mimeType: "image/png" };
  it("stores image asset references rather than inline model bytes", () => {
    assert.deepEqual(
      storedToolResultSchema.parse({ contentBlocks: [image] }).contentBlocks,
      [image],
    );
    assert.deepEqual(agentProjectionSchema.parse([image]), [image]);
  });
  it("requires an asset reference for stored and agent projection images", () => {
    const inline = { type: "image", data: "base64", mimeType: "image/png" };
    assert.equal(
      storedToolResultSchema.safeParse({ contentBlocks: [inline] }).success,
      false,
    );
    assert.equal(agentProjectionSchema.safeParse([inline]).success, false);
  });
});
