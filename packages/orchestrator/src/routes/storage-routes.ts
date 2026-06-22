import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createStorageRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/storage", (c) =>
    c.json({
      dataDir: state.storage.paths.home,
      sqlitePath: state.storage.paths.sqlitePath,
      configPath: state.storage.paths.configPath,
      counts: state.index.counts(),
    }),
  );
  app.post(
    "/storage/rebuild-index",
    routeHandler(async (c) => {
      await state.registry.rebuildIndex({ reindexEvents: true });
      return c.json({ ok: true, counts: state.index.counts() });
    }),
  );

  return app;
}
