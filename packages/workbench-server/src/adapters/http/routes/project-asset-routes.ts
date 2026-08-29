import { Hono } from "hono";
import type { ServerRuntime } from "../../../app/runtime/server-runtime.js";
type ProjectAssetRoutesContext = Pick<ServerRuntime, "services">;
import { routeHandler } from "../responses.js";
import { routeParam } from "../route-params.js";

export function createProjectAssetRoutes(
  state: ProjectAssetRoutesContext,
): Hono {
  const app = new Hono();
  app.get(
    "/:projectId/icon",
    routeHandler(async (c) => {
      const icon = await state.services.projectIcons.get(
        routeParam(c, "projectId"),
      );
      const cacheHeaders = {
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      };
      if (!icon) {
        return c.body(null, 404, {
          ...cacheHeaders,
          "Cache-Control": "private, no-cache",
        });
      }
      if (c.req.header("if-none-match") === icon.etag) {
        return c.body(null, 304, { ...cacheHeaders, ETag: icon.etag });
      }
      return c.body(new Uint8Array(icon.buffer), 200, {
        ...cacheHeaders,
        "Content-Type": icon.mimeType,
        ETag: icon.etag,
      });
    }),
  );
  return app;
}
