import {
  cancelTaskRequestSchema,
  startTaskRequestSchema,
  taskLogQuerySchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { numberQuery } from "../http/query.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";
import type { OrchestratorState } from "../server.js";

export function createTaskRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/tasks", (c) => c.json({ tasks: state.registry.listTasks() }));
  app.post(
    "/tasks",
    routeHandler(async (c) => {
      const body = startTaskRequestSchema.parse(await c.req.json());
      return c.json({ task: await state.registry.startTask(body) }, 201);
    }),
  );
  app.get(
    "/tasks/:taskId",
    routeHandler((c) =>
      c.json({
        task: state.registry.getTask(routeParam(c, "taskId")),
      }),
    ),
  );
  app.post(
    "/tasks/:taskId/cancel",
    routeHandler(async (c) => {
      const body = cancelTaskRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        task: await state.registry.cancelTask(routeParam(c, "taskId"), body),
      });
    }),
  );
  app.post(
    "/tasks/:taskId/restart",
    routeHandler(async (c) =>
      c.json({
        task: await state.registry.restartTask(routeParam(c, "taskId")),
      }),
    ),
  );
  app.post(
    "/tasks/prune",
    routeHandler(async (c) =>
      c.json({ removed: await state.registry.pruneTasks() }),
    ),
  );
  app.delete(
    "/tasks/:taskId",
    routeHandler(async (c) => {
      await state.registry.removeTask(routeParam(c, "taskId"));
      return c.json({ removed: true });
    }),
  );
  app.get(
    "/tasks/:taskId/logs",
    routeHandler(async (c) => {
      const query = taskLogQuerySchema.parse({
        mode: c.req.query("mode"),
        sinceSeq: numberQuery(c.req.query("sinceSeq")),
        contains: c.req.query("contains"),
        regex: c.req.query("regex"),
        contextLines: numberQuery(c.req.query("contextLines")),
        limit: numberQuery(c.req.query("limit")),
      });
      return c.json(
        await state.registry.queryTaskLogs(routeParam(c, "taskId"), query),
      );
    }),
  );

  return app;
}
