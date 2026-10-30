import assert from "node:assert/strict";
import test from "node:test";
import { MissingAssetError } from "@nervekit/conversation-core";
import { createConversationAssetRoutes } from "./conversation-asset-routes.js";

for (const missing of ["row", "file"] as const) {
  void test(`a missing asset ${missing} returns a typed path-free 404`, async () => {
    const routes = createConversationAssetRoutes({
      assets: {
        readImage: async () => {
          if (missing === "file") throw new MissingAssetError();
          return null;
        },
      },
    } as unknown as Parameters<typeof createConversationAssetRoutes>[0]);
    const response = await routes.request("/asset_missing");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
    });
  });
}

void test("unsafe ownership failures are not normalized into missing assets", async () => {
  const routes = createConversationAssetRoutes({
    assets: {
      readImage: async () => {
        throw new Error("Asset path does not match its owner");
      },
    },
  } as unknown as Parameters<typeof createConversationAssetRoutes>[0]);
  const response = await routes.request("/asset_wrong_owner");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Asset path does not match its owner",
    },
  });
});
