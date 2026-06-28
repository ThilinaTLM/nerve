import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

export function createWorkerRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/workers", (c) => c.json({ workers: state.registry.listWorkers() }));
  app.get(
    "/workers/:workerId",
    routeHandler((c) =>
      c.json({
        worker: state.registry.getWorker(routeParam(c, "workerId")),
      }),
    ),
  );

  return app;
}
