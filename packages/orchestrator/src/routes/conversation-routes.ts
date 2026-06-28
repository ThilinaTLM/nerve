import {
  compactConversationRequestSchema,
  createConversationRequestSchema,
  importConversationRequestSchema,
  navigateConversationRequestSchema,
} from "@nervekit/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";
import type { OrchestratorState } from "../app/orchestrator-state.js";

function conversationExportHeaders(
  conversationId: string,
  extension: "json" | "md" | "html",
  contentType: string,
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="conversation-${conversationId}.${extension}"`,
  };
}

export function createConversationRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.post(
    "/conversations",
    routeHandler(async (c) => {
      const body = createConversationRequestSchema.parse(await c.req.json());
      return c.json(
        { conversation: await state.registry.createConversation(body) },
        201,
      );
    }),
  );
  app.post(
    "/conversations/import",
    routeHandler(async (c) => {
      const body = importConversationRequestSchema.parse(await c.req.json());
      return c.json(await state.registry.importConversation(body), 201);
    }),
  );
  app.get("/conversations", (c) =>
    c.json({ conversations: state.registry.listConversations() }),
  );
  app.get(
    "/conversations/:conversationId",
    routeHandler((c) =>
      c.json({
        conversation: state.registry.getConversation(
          routeParam(c, "conversationId"),
        ),
      }),
    ),
  );
  app.delete(
    "/conversations/:conversationId",
    routeHandler(async (c) => {
      await state.registry.removeConversation(routeParam(c, "conversationId"));
      return c.body(null, 204);
    }),
  );
  app.get(
    "/conversations/:conversationId/entries",
    routeHandler((c) =>
      c.json({
        entries: state.registry.getConversationEntries(
          routeParam(c, "conversationId"),
        ),
      }),
    ),
  );
  app.get(
    "/conversations/:conversationId/snapshot",
    routeHandler(async (c) =>
      c.json({
        snapshot: await state.registry.getConversationSnapshot(
          routeParam(c, "conversationId"),
        ),
      }),
    ),
  );
  app.get(
    "/conversations/:conversationId/context-usage",
    routeHandler(async (c) =>
      c.json({
        contextUsage: await state.registry.getContextUsage(
          routeParam(c, "conversationId"),
        ),
      }),
    ),
  );
  app.get(
    "/conversations/:conversationId/export",
    routeHandler((c) => {
      const conversationId = routeParam(c, "conversationId");
      return c.json(
        state.registry.exportConversation(conversationId),
        200,
        conversationExportHeaders(
          conversationId,
          "json",
          "application/json; charset=utf-8",
        ),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/export.md",
    routeHandler((c) => {
      const conversationId = routeParam(c, "conversationId");
      return c.text(
        state.registry.exportConversationMarkdown(conversationId),
        200,
        conversationExportHeaders(
          conversationId,
          "md",
          "text/markdown; charset=utf-8",
        ),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/export.html",
    routeHandler((c) => {
      const conversationId = routeParam(c, "conversationId");
      return c.html(
        state.registry.exportConversationHtml(conversationId),
        200,
        conversationExportHeaders(
          conversationId,
          "html",
          "text/html; charset=utf-8",
        ),
      );
    }),
  );
  app.get(
    "/conversations/:conversationId/tree",
    routeHandler((c) =>
      c.json({
        tree: state.registry.getConversationTree(
          routeParam(c, "conversationId"),
        ),
      }),
    ),
  );
  app.post(
    "/conversations/:conversationId/navigate",
    routeHandler(async (c) => {
      const body = navigateConversationRequestSchema.parse(await c.req.json());
      return c.json({
        conversation: await state.registry.navigateConversation(
          routeParam(c, "conversationId"),
          body,
        ),
      });
    }),
  );
  app.post(
    "/conversations/:conversationId/compact",
    routeHandler(async (c) => {
      const body = compactConversationRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.compactConversation(
          routeParam(c, "conversationId"),
          body,
        ),
      );
    }),
  );

  return app;
}
