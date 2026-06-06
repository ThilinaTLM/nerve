import {
  compactConversationRequestSchema,
  createConversationRequestSchema,
  importConversationRequestSchema,
  navigateConversationRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

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
          c.req.param("conversationId"),
        ),
      }),
    ),
  );
  app.delete(
    "/conversations/:conversationId",
    routeHandler(async (c) => {
      await state.registry.removeConversation(c.req.param("conversationId"));
      return c.body(null, 204);
    }),
  );
  app.get(
    "/conversations/:conversationId/entries",
    routeHandler((c) =>
      c.json({
        entries: state.registry.getConversationEntries(
          c.req.param("conversationId"),
        ),
      }),
    ),
  );
  app.get(
    "/conversations/:conversationId/snapshot",
    routeHandler(async (c) =>
      c.json({
        snapshot: await state.registry.getConversationSnapshot(
          c.req.param("conversationId"),
        ),
      }),
    ),
  );
  app.get(
    "/conversations/:conversationId/context-usage",
    routeHandler(async (c) =>
      c.json({
        contextUsage: await state.registry.getContextUsage(
          c.req.param("conversationId"),
        ),
      }),
    ),
  );
  app.get(
    "/conversations/:conversationId/export",
    routeHandler((c) =>
      c.json(state.registry.exportConversation(c.req.param("conversationId"))),
    ),
  );
  app.get(
    "/conversations/:conversationId/export.md",
    routeHandler((c) =>
      c.text(
        state.registry.exportConversationMarkdown(
          c.req.param("conversationId"),
        ),
        200,
        {
          "content-type": "text/markdown; charset=utf-8",
        },
      ),
    ),
  );
  app.get(
    "/conversations/:conversationId/export.html",
    routeHandler((c) =>
      c.html(
        state.registry.exportConversationHtml(c.req.param("conversationId")),
      ),
    ),
  );
  app.get(
    "/conversations/:conversationId/tree",
    routeHandler((c) =>
      c.json({
        tree: state.registry.getConversationTree(c.req.param("conversationId")),
      }),
    ),
  );
  app.post(
    "/conversations/:conversationId/navigate",
    routeHandler(async (c) => {
      const body = navigateConversationRequestSchema.parse(await c.req.json());
      return c.json({
        conversation: await state.registry.navigateConversation(
          c.req.param("conversationId"),
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
          c.req.param("conversationId"),
          body,
        ),
      );
    }),
  );

  return app;
}
