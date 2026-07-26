import {
  createPromptSuggestionRequestSchema,
  updatePromptSuggestionEnabledRequestSchema,
  updatePromptSuggestionTrustRequestSchema,
} from "@nervekit/contracts";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

export function createPromptSuggestionRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get(
    "/projects/:projectId/prompt-suggestions",
    routeHandler(async (c) =>
      c.json(
        await state.registry.promptSuggestions.listForProject(
          routeParam(c, "projectId"),
          {
            conversationId: c.req.query("conversationId"),
            agentId: c.req.query("agentId"),
          },
        ),
      ),
    ),
  );

  app.get(
    "/prompt-suggestions/statuses",
    routeHandler(async (c) =>
      c.json({
        statuses: await state.registry.promptSuggestions.listStatuses(
          c.req.query("projectId"),
        ),
      }),
    ),
  );

  app.post(
    "/prompt-suggestions",
    routeHandler(async (c) => {
      const body = createPromptSuggestionRequestSchema.parse(
        await c.req.json(),
      );
      return c.json({
        suggestion: await state.registry.promptSuggestions.create(body),
      });
    }),
  );

  app.post(
    "/prompt-suggestions/enabled",
    routeHandler(async (c) => {
      const body = updatePromptSuggestionEnabledRequestSchema.parse(
        await c.req.json(),
      );
      await state.registry.promptSuggestions.updateEnabled(body);
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/prompt-suggestions/trust",
    routeHandler(async (c) => {
      const body = updatePromptSuggestionTrustRequestSchema.parse(
        await c.req.json(),
      );
      await state.registry.promptSuggestions.updateTrust(body);
      return c.json({ ok: true });
    }),
  );

  return app;
}
