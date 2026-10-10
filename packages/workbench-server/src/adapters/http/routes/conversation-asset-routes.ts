import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
import { routeHandler } from "../responses.js";
import { routeParam } from "../route-params.js";

type ConversationAssetRoutesContext =
  ServerAdapterContexts["http"]["conversationAssets"];

/** Mounted under /api/assets, behind the daemon's shared API authentication. */
export function createConversationAssetRoutes(
  state: ConversationAssetRoutesContext,
): Hono {
  const app = new Hono();
  app.get(
    "/:assetId",
    routeHandler(async (c) => {
      const image = await state.assets.readImage(routeParam(c, "assetId"));
      if (!image) return c.notFound();
      return c.body(new Uint8Array(image.bytes), 200, {
        "Content-Type": image.mediaType,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
    }),
  );
  return app;
}
