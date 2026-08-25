import { Hono } from "hono";
import type { WorkbenchState } from "../app/workbench-state.js";

export function createSettingsRoutes(state: WorkbenchState): Hono {
  const app = new Hono();

  app.get("/settings", (c) => c.json(state.storage.settings));

  return app;
}
