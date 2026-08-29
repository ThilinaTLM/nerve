import { taskLogQuerySchema } from "@nervekit/contracts/tasks";
import { Hono } from "hono";
import type { ServerRuntime } from "../../../app/runtime/server-runtime.js";
type TaskLogRoutesContext = Pick<ServerRuntime, "services">;
import { HttpError } from "../errors.js";
import { numberQuery } from "../query.js";
import { routeHandler } from "../responses.js";
import { routeParam } from "../route-params.js";

export function createTaskLogRoutes(state: TaskLogRoutesContext): Hono {
  const app = new Hono();
  app.get(
    "/tasks/:taskId/logs",
    routeHandler(async (c) => {
      const query = taskLogQuerySchema.parse({
        mode: c.req.query("mode"),
        sinceSeq: numberQuery(c.req.query("sinceSeq")),
        beforeSeq: numberQuery(c.req.query("beforeSeq")),
        contains: c.req.query("contains"),
        regex: c.req.query("regex"),
        contextLines: numberQuery(c.req.query("contextLines")),
        limit: numberQuery(c.req.query("limit")),
      });
      const taskId = routeParam(c, "taskId");
      try {
        state.services.tasks.getTask(taskId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Task not found/i.test(message)) {
          throw new HttpError(
            404,
            "TASK_NOT_FOUND",
            `Task '${taskId}' not found.`,
          );
        }
        throw error;
      }
      return c.json(await state.services.tasks.queryLogs(taskId, query));
    }),
  );
  return app;
}
