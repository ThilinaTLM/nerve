import { Hono } from "hono";
import type { ServerRuntime } from "../../../app/runtime/server-runtime.js";
type ConversationExportRoutesContext = Pick<ServerRuntime, "services">;
import { routeHandler } from "../responses.js";
import { routeParam } from "../route-params.js";

function headers(
  conversationId: string,
  extension: "json" | "md" | "html",
  contentType: string,
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="conversation-${conversationId}.${extension}"`,
  };
}

export function createConversationExportRoutes(
  state: ConversationExportRoutesContext,
): Hono {
  const app = new Hono();
  app.get(
    "/conversations/:conversationId/export",
    routeHandler((c) => {
      const id = routeParam(c, "conversationId");
      return c.json(
        state.services.exportService.exportConversation(id),
        200,
        headers(id, "json", "application/json; charset=utf-8"),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/export.md",
    routeHandler((c) => {
      const id = routeParam(c, "conversationId");
      return c.text(
        state.services.exportService.exportConversationMarkdown(id),
        200,
        headers(id, "md", "text/markdown; charset=utf-8"),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/export.html",
    routeHandler((c) => {
      const id = routeParam(c, "conversationId");
      return c.html(
        state.services.exportService.exportConversationHtml(id),
        200,
        headers(id, "html", "text/html; charset=utf-8"),
      );
    }),
  );
  return app;
}
