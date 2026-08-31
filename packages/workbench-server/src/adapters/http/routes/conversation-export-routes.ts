import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type ConversationExportRoutesContext =
  ServerAdapterContexts["http"]["conversationExport"];
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
    routeHandler(async (c) => {
      const id = routeParam(c, "conversationId");
      return c.json(
        await state.exportService.exportConversation(id),
        200,
        headers(id, "json", "application/json; charset=utf-8"),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/export.md",
    routeHandler(async (c) => {
      const id = routeParam(c, "conversationId");
      return c.text(
        await state.exportService.exportConversationMarkdown(id),
        200,
        headers(id, "md", "text/markdown; charset=utf-8"),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/export.html",
    routeHandler(async (c) => {
      const id = routeParam(c, "conversationId");
      return c.html(
        await state.exportService.exportConversationHtml(id),
        200,
        headers(id, "html", "text/html; charset=utf-8"),
      );
    }),
  );
  return app;
}
