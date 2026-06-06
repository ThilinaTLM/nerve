import {
  compactSessionRequestSchema,
  createSessionRequestSchema,
  importSessionRequestSchema,
  navigateSessionRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createSessionRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.post(
    "/sessions",
    routeHandler(async (c) => {
      const body = createSessionRequestSchema.parse(await c.req.json());
      return c.json({ session: await state.registry.createSession(body) }, 201);
    }),
  );
  app.post(
    "/import/session",
    routeHandler(async (c) => {
      const body = importSessionRequestSchema.parse(await c.req.json());
      return c.json(await state.registry.importSession(body), 201);
    }),
  );
  app.get("/sessions", (c) =>
    c.json({ sessions: state.registry.listSessions() }),
  );
  app.get(
    "/sessions/:sessionId",
    routeHandler((c) =>
      c.json({
        session: state.registry.getSession(c.req.param("sessionId")),
      }),
    ),
  );
  app.delete(
    "/sessions/:sessionId",
    routeHandler(async (c) => {
      await state.registry.removeSession(c.req.param("sessionId"));
      return c.body(null, 204);
    }),
  );
  app.get(
    "/sessions/:sessionId/messages",
    routeHandler((c) =>
      c.json({
        entries: state.registry.getSessionEntries(c.req.param("sessionId")),
      }),
    ),
  );
  app.get(
    "/sessions/:sessionId/conversation",
    routeHandler(async (c) =>
      c.json({
        conversation: await state.registry.getConversationSnapshot(
          c.req.param("sessionId"),
        ),
      }),
    ),
  );
  app.get(
    "/sessions/:sessionId/context-usage",
    routeHandler(async (c) =>
      c.json({
        contextUsage: await state.registry.getContextUsage(
          c.req.param("sessionId"),
        ),
      }),
    ),
  );
  app.get(
    "/sessions/:sessionId/export",
    routeHandler((c) =>
      c.json(state.registry.exportSession(c.req.param("sessionId"))),
    ),
  );
  app.get(
    "/sessions/:sessionId/export.md",
    routeHandler((c) =>
      c.text(
        state.registry.exportSessionMarkdown(c.req.param("sessionId")),
        200,
        {
          "content-type": "text/markdown; charset=utf-8",
        },
      ),
    ),
  );
  app.get(
    "/sessions/:sessionId/export.html",
    routeHandler((c) =>
      c.html(state.registry.exportSessionHtml(c.req.param("sessionId"))),
    ),
  );
  app.get(
    "/sessions/:sessionId/tree",
    routeHandler((c) =>
      c.json({
        tree: state.registry.getSessionTree(c.req.param("sessionId")),
      }),
    ),
  );
  app.post(
    "/sessions/:sessionId/navigate",
    routeHandler(async (c) => {
      const body = navigateSessionRequestSchema.parse(await c.req.json());
      return c.json({
        session: await state.registry.navigateSession(
          c.req.param("sessionId"),
          body,
        ),
      });
    }),
  );
  app.post(
    "/sessions/:sessionId/compact",
    routeHandler(async (c) => {
      const body = compactSessionRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.compactSession(c.req.param("sessionId"), body),
      );
    }),
  );

  return app;
}
