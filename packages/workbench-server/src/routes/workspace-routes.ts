import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { getWorkspaceSnapshotResponse } from "../protocol/snapshots.js";

export function createWorkspaceRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/workspace/snapshot", (c) =>
    c.json(getWorkspaceSnapshotResponse(state)),
  );

  return app;
}
