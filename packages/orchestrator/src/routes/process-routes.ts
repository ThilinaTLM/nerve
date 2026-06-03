import {
  processLogQuerySchema,
  startProcessRequestSchema,
  stopProcessRequestSchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { numberQuery } from "../http/query.js";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createProcessRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/processes", (c) =>
    c.json({ processes: state.registry.listProcesses() }),
  );
  app.post(
    "/processes",
    routeHandler(async (c) => {
      const body = startProcessRequestSchema.parse(await c.req.json());
      return c.json({ process: await state.registry.startProcess(body) }, 201);
    }),
  );
  app.get(
    "/processes/:processId",
    routeHandler((c) =>
      c.json({
        process: state.registry.getProcess(c.req.param("processId")),
      }),
    ),
  );
  app.post(
    "/processes/:processId/stop",
    routeHandler(async (c) => {
      const body = stopProcessRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        process: await state.registry.stopProcess(
          c.req.param("processId"),
          body,
        ),
      });
    }),
  );
  app.post(
    "/processes/:processId/restart",
    routeHandler(async (c) =>
      c.json({
        process: await state.registry.restartProcess(c.req.param("processId")),
      }),
    ),
  );
  app.post(
    "/processes/prune",
    routeHandler(async (c) =>
      c.json({ removed: await state.registry.pruneProcesses() }),
    ),
  );
  app.delete(
    "/processes/:processId",
    routeHandler(async (c) => {
      await state.registry.removeProcess(c.req.param("processId"));
      return c.json({ removed: true });
    }),
  );
  app.get(
    "/processes/:processId/logs",
    routeHandler(async (c) => {
      const query = processLogQuerySchema.parse({
        mode: c.req.query("mode"),
        sinceSeq: numberQuery(c.req.query("sinceSeq")),
        contains: c.req.query("contains"),
        regex: c.req.query("regex"),
        contextLines: numberQuery(c.req.query("contextLines")),
        limit: numberQuery(c.req.query("limit")),
      });
      return c.json(
        await state.registry.queryProcessLogs(c.req.param("processId"), query),
      );
    }),
  );

  return app;
}
