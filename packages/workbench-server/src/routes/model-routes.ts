import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";

export function createModelRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/models", (c) => c.json({ models: state.registry.listModels() }));

  app.get("/usage/subscription", async (c) =>
    c.json({ usage: await state.registry.getSubscriptionUsage() }),
  );

  return app;
}
