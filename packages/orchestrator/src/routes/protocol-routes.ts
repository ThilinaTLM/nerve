import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { ProtocolHttpDispatcher } from "../protocol/http-dispatcher.js";

export function createProtocolRoutes(state: OrchestratorState): Hono {
  const app = new Hono();
  const dispatcher = new ProtocolHttpDispatcher(state);

  app.post("/protocol/v1", (c) => dispatcher.dispatch(c.req.raw));

  return app;
}
