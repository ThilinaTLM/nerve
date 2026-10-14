import { Hono } from "hono";
import { htmlPreviewRevokeRequestSchema } from "@nervekit/contracts/filesystem";
import { HtmlPreviewService } from "../../../domains/filesystem/html-preview.service.js";
import { errorResponse, HttpError } from "../errors.js";
import { routeHandler } from "../responses.js";

/** One in-memory service is shared by authenticated lifecycle and capability routes. */
export function createHtmlPreviewRoutes(
  getDirectory: (projectId: string) => string,
): Hono {
  const app = new Hono();
  const previews = new HtmlPreviewService(getDirectory);
  app.post(
    "/api/filesystem/html-preview",
    routeHandler(async (c) => {
      const length = Number(c.req.header("content-length"));
      if (length > 7 * 1_024 * 1_024)
        return c.text("Preview request too large", 413);
      // Bound the JSON envelope before parsing (escaped draft text can be larger than its UTF-8 representation).
      const reader = c.req.raw.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 7 * 1_024 * 1_024) {
              await reader.cancel();
              return c.text("Preview request too large", 413);
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new HttpError(400, "INVALID_PREVIEW", "Invalid JSON request.");
      }
      return c.json(await previews.create(input, new URL(c.req.url).origin));
    }),
  );
  app.delete(
    "/api/filesystem/html-preview/:id",
    routeHandler((c) => {
      const parsed = htmlPreviewRevokeRequestSchema.safeParse({
        id: c.req.param("id"),
      });
      if (!parsed.success)
        throw new HttpError(400, "INVALID_PREVIEW", "Invalid preview ID.");
      previews.revoke(parsed.data.id);
      return c.body(null, 204);
    }),
  );
  app.use("/html-preview/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "no-referrer");
  });
  // Capability URLs are credentials: do not send resource failures to request diagnostics.
  app.all("/html-preview/*", async (c) => {
    try {
      if (c.req.method !== "GET" && c.req.method !== "HEAD")
        return c.text("Method not allowed", 405, { Allow: "GET, HEAD" });
      const match =
        /^\/html-preview\/([a-f0-9]{64})\/(document|assets\/(.+))$/.exec(
          new URL(c.req.url).pathname,
        );
      if (!match) return c.notFound();
      return await previews.resource(
        match[1],
        match[3],
        new URL(c.req.url).origin,
        c.req.method === "HEAD",
      );
    } catch {
      return errorResponse(
        new HttpError(
          404,
          "PREVIEW_NOT_FOUND",
          "Preview resource unavailable.",
        ),
      );
    }
  });
  return app;
}
