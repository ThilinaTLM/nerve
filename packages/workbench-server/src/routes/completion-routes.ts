import {
  fileCompletionQuerySchema,
  slashCommandCompletionItems,
} from "@nervekit/contracts";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { routeHandler } from "../http/responses.js";

export function createCompletionRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/completions/slash", (c) =>
    c.json({ items: [...slashCommandCompletionItems] }),
  );
  app.get(
    "/completions/files",
    routeHandler(async (c) => {
      const query = fileCompletionQuerySchema.parse({
        projectId: c.req.query("projectId"),
        q: c.req.query("q"),
        limit: c.req.query("limit"),
      });
      return c.json({
        items: await state.registry.completeFiles(query.projectId, query.q, {
          limit: query.limit,
        }),
      });
    }),
  );

  return app;
}
