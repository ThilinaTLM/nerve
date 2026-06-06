import { Hono } from "hono";
import type { OrchestratorState } from "../server.js";

export function createModelRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/models", (c) => c.json({ models: state.registry.listModels() }));

  app.get("/usage/subscription", (c) =>
    c.json({ usage: state.registry.getSubscriptionUsage() }),
  );

  return app;
}
