import { Hono } from "hono";
import type { ServerRuntime } from "../../../app/runtime/server-runtime.js";
type SettingsRoutesContext = Pick<ServerRuntime, "storage">;

export function createSettingsRoutes(state: SettingsRoutesContext): Hono {
  const app = new Hono();

  app.get("/settings", (c) => c.json(state.storage.settings));

  return app;
}
