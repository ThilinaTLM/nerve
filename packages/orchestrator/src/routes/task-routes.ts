import {
  cancelTaskRequestSchema,
  startTaskRequestSchema,
  taskLogQuerySchema,
} from "@nervekit/shared";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { HttpError } from "../http/errors.js";
import { numberQuery } from "../http/query.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

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
    routeHandler((c) => {
      const taskId = routeParam(c, "taskId");
      return c.json({ task: getTaskOrThrow(state, taskId) });
    }),
  );
  app.post(
    "/tasks/:taskId/cancel",
    routeHandler(async (c) => {
      const body = cancelTaskRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      const taskId = routeParam(c, "taskId");
      getTaskOrThrow(state, taskId);
      return c.json({
        task: await state.registry.cancelTask(taskId, body),
      });
    }),
  );
  app.post(
    "/tasks/:taskId/restart",
    routeHandler(async (c) => {
      const taskId = routeParam(c, "taskId");
      getTaskOrThrow(state, taskId);
      return c.json({
        task: await state.registry.restartTask(taskId),
      });
    }),
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
      const taskId = routeParam(c, "taskId");
      getTaskOrThrow(state, taskId);
      await state.registry.removeTask(taskId);
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
      const taskId = routeParam(c, "taskId");
      getTaskOrThrow(state, taskId);
      return c.json(await state.registry.queryTaskLogs(taskId, query));
    }),
  );

  return app;
}

function getTaskOrThrow(
  state: OrchestratorState,
  taskId: string,
): ReturnType<OrchestratorState["registry"]["getTask"]> {
  try {
    return state.registry.getTask(taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Task not found/i.test(message)) {
      throw new HttpError(404, "TASK_NOT_FOUND", `Task '${taskId}' not found.`);
    }
    throw error;
  }
}
