import { Hono } from "hono";
import type { WorkbenchState } from "../app/workbench-state.js";
import { ProtocolHttpDispatcher } from "../protocol/http-dispatcher.js";

export function createProtocolRoutes(state: WorkbenchState): Hono {
  const app = new Hono();
  const dispatcher = new ProtocolHttpDispatcher(state);

  app.post("/protocol/v1", (c) => dispatcher.dispatch(c.req.raw));

  return app;
}
