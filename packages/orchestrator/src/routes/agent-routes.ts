import {
  continueFromFailureRequestSchema,
  createAgentRequestSchema,
  executeToolRequestSchema,
  promptRequestSchema,
  updateAgentRequestSchema,
} from "@nervekit/shared";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { buildAgentSystemPrompt } from "../domains/agents/run/system-prompt-builder.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

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
      c.json({ agent: state.registry.getAgent(routeParam(c, "agentId")) }),
    ),
  );
  app.get(
    "/agents/:agentId/system-prompt",
    routeHandler(async (c) => {
      const agentId = routeParam(c, "agentId");
      const agent = state.registry.getAgent(agentId);
      const pythonAvailable =
        await state.registry.pythonRuntime.isAvailableForProject(
          agent.projectDir,
        );
      const prompt = await buildAgentSystemPrompt(agent, {
        storageHome: state.storage.paths.home,
        pythonAvailable,
        disabledToolNames: state.storage.settings.tools.disabled,
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
          routeParam(c, "agentId"),
          body,
        ),
      });
    }),
  );
  app.post(
    "/agents/:agentId/prompt",
    routeHandler(async (c) => {
      const body = promptRequestSchema.parse(await c.req.json());
      await state.registry.promptAgent(routeParam(c, "agentId"), body);
      return c.json({ ok: true }, 202);
    }),
  );
  app.get(
    "/agents/:agentId/prompt-queue",
    routeHandler(async (c) =>
      c.json({
        queuedPrompts: await state.registry.listQueuedPrompts(
          routeParam(c, "agentId"),
        ),
      }),
    ),
  );
  app.delete(
    "/agents/:agentId/prompt-queue/:queuedPromptId",
    routeHandler(async (c) =>
      c.json({
        queuedPrompt: await state.registry.cancelQueuedPrompt(
          routeParam(c, "agentId"),
          routeParam(c, "queuedPromptId"),
        ),
      }),
    ),
  );
  app.post(
    "/agents/:agentId/tools",
    routeHandler(async (c) => {
      const body = executeToolRequestSchema.parse(await c.req.json());
      const result = await state.registry.requestTool(
        routeParam(c, "agentId"),
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
        routeParam(c, "agentId"),
        body.statusEntryId,
      );
      return c.json({ ok: true }, 202);
    }),
  );

  app.post(
    "/agents/:agentId/abort",
    routeHandler(async (c) => {
      await state.registry.abortAgent(routeParam(c, "agentId"));
      return c.json({ ok: true });
    }),
  );

  return app;
}
