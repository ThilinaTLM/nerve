import {
  applicationLogQuerySchema,
  clientApplicationLogRequestSchema,
} from "@nervekit/contracts/logs";
import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type LogRoutesContext = ServerAdapterContexts["http"]["logs"];
import { numberQuery } from "../query.js";
import { routeHandler } from "../responses.js";

export function createLogRoutes(state: LogRoutesContext): Hono {
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
        beforeSeq: numberQuery(c.req.query("beforeSeq")),
        limit: numberQuery(c.req.query("limit")),
        requestId: c.req.query("requestId"),
        projectId: c.req.query("projectId"),
        conversationId: c.req.query("conversationId"),
        agentId: c.req.query("agentId"),
        runId: c.req.query("runId"),
        toolCallId: c.req.query("toolCallId"),
        taskId: c.req.query("taskId"),
      });
      return c.json(await state.logger.query(query));
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
