import { Hono } from "hono";
import { type WorkbenchState, statusResponse } from "../app/workbench-state.js";
import { version } from "../app/version.js";

export function createStatusRoutes(state: WorkbenchState): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok", version }));
  app.get("/client-config", (c) =>
    c.json({
      url: `http://${state.host}:${state.port}`,
      wsUrl: `ws://${state.host}:${state.port}/ws`,
      status: statusResponse(state),
    }),
  );
  return app;
}
