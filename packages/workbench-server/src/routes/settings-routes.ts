import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";

export function createSettingsRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/settings", (c) => c.json(state.storage.settings));

  return app;
}
