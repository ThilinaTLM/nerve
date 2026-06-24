import { updateSettingsRequestSchema } from "@nervekit/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import { writeSettings } from "../infrastructure/storage/index.js";
import type { OrchestratorState } from "../server.js";

export function createSettingsRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/settings", (c) => c.json(state.storage.settings));
  app.put(
    "/settings",
    routeHandler(async (c) => {
      const body = updateSettingsRequestSchema.parse(await c.req.json());
      const settings = await writeSettings(state.storage, body);
      if (body.runtime && "pythonExecutablePath" in body.runtime) {
        await state.registry.pythonRuntime.refresh();
      }
      await state.events.publish("settings.updated", { settings });
      return c.json({ settings });
    }),
  );

  return app;
}
