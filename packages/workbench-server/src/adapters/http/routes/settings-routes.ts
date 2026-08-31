import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type SettingsRoutesContext = ServerAdapterContexts["http"]["settings"];

export function createSettingsRoutes(state: SettingsRoutesContext): Hono {
  const app = new Hono();

  app.get("/settings", (c) => c.json(state.storage.settings));

  return app;
}
