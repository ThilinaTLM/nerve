import { Hono } from "hono";
import {
  type OrchestratorState,
  statusResponse,
} from "../app/orchestrator-state.js";

export function createStatusRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/status", (c) => c.json(statusResponse(state)));
  app.get("/events", async (c) => {
    const since = Number(c.req.query("since") ?? "0");
    const stream = c.req.query("stream") ?? "workspace";
    const read = await state.events.readStream(
      stream,
      (Number.isFinite(since) ? since : 0) + 1,
      5_000,
    );
    return c.json({
      stream,
      events: read.events,
      cursorSeq: read.latestSeq,
      earliestAvailableSeq: read.earliestAvailableSeq,
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
