import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createWorkerRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/workers", (c) => c.json({ workers: state.registry.listWorkers() }));
  app.get(
    "/workers/:workerId",
    routeHandler((c) =>
      c.json({
        worker: state.registry.getWorker(c.req.param("workerId")),
      }),
    ),
  );

  return app;
}
