import {
  applicationLogPruneRequestSchema,
  applicationLogQuerySchema,
  clientApplicationLogRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { numberQuery } from "../http/query.js";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createLogRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get(
    "/logs",
    routeHandler(async (c) => {
      const query = applicationLogQuerySchema.parse({
        level: c.req.query("level"),
        source: c.req.query("source"),
        component: c.req.query("component"),
        contains: c.req.query("contains"),
        sinceSeq: numberQuery(c.req.query("sinceSeq")),
        limit: numberQuery(c.req.query("limit")),
        requestId: c.req.query("requestId"),
        projectId: c.req.query("projectId"),
        conversationId: c.req.query("conversationId"),
        agentId: c.req.query("agentId"),
        runId: c.req.query("runId"),
        toolCallId: c.req.query("toolCallId"),
        taskId: c.req.query("taskId"),
        workerId: c.req.query("workerId"),
      });
      return c.json(await state.logger.query(query));
    }),
  );

  app.post(
    "/logs/prune",
    routeHandler(async (c) => {
      const body = applicationLogPruneRequestSchema.parse(await c.req.json());
      return c.json(await state.logger.prune(body));
    }),
  );

  app.post(
    "/logs/client",
    routeHandler(async (c) => {
      const body = clientApplicationLogRequestSchema.parse(await c.req.json());
      for (const log of body.logs) {
        const logger = state.logger.child({
          component: log.component,
          source: "web",
        });
        await logger[log.level](log.message, {
          requestId: log.requestId,
          projectId: log.projectId,
          conversationId: log.conversationId,
          agentId: log.agentId,
          runId: log.runId,
          toolCallId: log.toolCallId,
          taskId: log.taskId,
          workerId: log.workerId,
          durationMs: log.durationMs,
          context: { ...(log.context ?? {}), clientTs: log.ts },
          error: log.error,
        });
      }
      return c.json({ ok: true });
    }),
  );

  return app;
}
