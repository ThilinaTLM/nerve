import { Hono } from "hono";
import {
  statusResponse,
  type OrchestratorState,
} from "../app/orchestrator-state.js";

export function createStatusRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/status", (c) => c.json(statusResponse(state)));
  app.get("/events", async (c) => {
    const since = Number(c.req.query("since") ?? "0");
    return c.json({
      events: await state.events.replayPersistedSince(
        Number.isFinite(since) ? since : 0,
      ),
      cursorSeq: state.events.latestSeq,
    });
  });
  app.get("/client-config", (c) =>
    c.json({
      url: `http://${state.host}:${state.port}`,
      wsUrl: `ws://${state.host}:${state.port}/ws`,
      status: statusResponse(state),
    }),
  );

  return app;
}
