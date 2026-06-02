import {
  createAgentRequestSchema,
  executeToolRequestSchema,
  promptRequestSchema,
  updateAgentRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createAgentRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.post(
    "/agents",
    routeHandler(async (c) => {
      const body = createAgentRequestSchema.parse(await c.req.json());
      return c.json({ agent: await state.registry.createAgent(body) }, 201);
    }),
  );
  app.get("/agents", (c) => c.json({ agents: state.registry.listAgents() }));
  app.get(
    "/agents/:agentId",
    routeHandler((c) =>
      c.json({ agent: state.registry.getAgent(c.req.param("agentId")) }),
    ),
  );
  app.patch(
    "/agents/:agentId",
    routeHandler(async (c) => {
      const body = updateAgentRequestSchema.parse(await c.req.json());
      return c.json({
        agent: await state.registry.configureAgent(
          c.req.param("agentId"),
          body,
        ),
      });
    }),
  );
  app.post(
    "/agents/:agentId/prompt",
    routeHandler(async (c) => {
      const body = promptRequestSchema.parse(await c.req.json());
      await state.registry.promptAgent(c.req.param("agentId"), body);
      return c.json({ ok: true }, 202);
    }),
  );
  app.post(
    "/agents/:agentId/tools",
    routeHandler(async (c) => {
      const body = executeToolRequestSchema.parse(await c.req.json());
      const result = await state.registry.requestTool(
        c.req.param("agentId"),
        body.toolName,
        body.args,
      );
      return c.json(result, result.approval ? 202 : 200);
    }),
  );
  app.post(
    "/agents/:agentId/abort",
    routeHandler(async (c) => {
      await state.registry.abortAgent(c.req.param("agentId"));
      return c.json({ ok: true });
    }),
  );

  return app;
}
