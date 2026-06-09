import {
  continueFromFailureRequestSchema,
  createAgentRequestSchema,
  executeToolRequestSchema,
  promptRequestSchema,
  updateAgentRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { buildAgentSystemPrompt } from "../agent-runner/system-prompt-builder.js";
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
  app.get(
    "/agents/:agentId/system-prompt",
    routeHandler(async (c) => {
      const agentId = c.req.param("agentId");
      const agent = state.registry.getAgent(agentId);
      const prompt = await buildAgentSystemPrompt(agent, {
        storageHome: state.storage.paths.home,
      });
      return c.body(prompt, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="system-prompt-${agentId}.md"`,
      });
    }),
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
  app.get(
    "/agents/:agentId/prompt-queue",
    routeHandler(async (c) =>
      c.json({
        queuedPrompts: await state.registry.listQueuedPrompts(
          c.req.param("agentId"),
        ),
      }),
    ),
  );
  app.delete(
    "/agents/:agentId/prompt-queue/:queuedPromptId",
    routeHandler(async (c) =>
      c.json({
        queuedPrompt: await state.registry.cancelQueuedPrompt(
          c.req.param("agentId"),
          c.req.param("queuedPromptId"),
        ),
      }),
    ),
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
    "/agents/:agentId/continue-from-failure",
    routeHandler(async (c) => {
      const body = continueFromFailureRequestSchema.parse(await c.req.json());
      await state.registry.continueFromFailedTurn(
        c.req.param("agentId"),
        body.statusEntryId,
      );
      return c.json({ ok: true }, 202);
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
