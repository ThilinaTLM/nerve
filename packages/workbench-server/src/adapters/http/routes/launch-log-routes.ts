import { launchLogQuerySchema } from "@nervekit/contracts/launches";
import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type LaunchLogRoutesContext = ServerAdapterContexts["http"]["launchLogs"];
import { HttpError } from "../errors.js";
import { numberQuery } from "../query.js";
import { routeHandler } from "../responses.js";
import { routeParam } from "../route-params.js";

export function createLaunchLogRoutes(state: LaunchLogRoutesContext): Hono {
  const app = new Hono();
  app.get(
    "/launches/:launchId/logs",
    routeHandler(async (c) => {
      const query = launchLogQuerySchema.parse({
        mode: c.req.query("mode"),
        sinceSeq: numberQuery(c.req.query("sinceSeq")),
        beforeSeq: numberQuery(c.req.query("beforeSeq")),
        contains: c.req.query("contains"),
        regex: c.req.query("regex"),
        contextLines: numberQuery(c.req.query("contextLines")),
        limit: numberQuery(c.req.query("limit")),
      });
      const launchId = routeParam(c, "launchId");
      try {
        await state.launches.require(launchId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Launch not found/i.test(message)) {
          throw new HttpError(
            404,
            "TASK_NOT_FOUND",
            `Launch '${launchId}' not found.`,
          );
        }
        throw error;
      }
      return c.json(await state.launches.queryLogs(launchId, query));
    }),
  );
  return app;
}
