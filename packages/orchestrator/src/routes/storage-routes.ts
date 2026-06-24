import { storageCleanupRequestSchema } from "@nervekit/shared";
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

  app.get(
    "/storage/usage",
    routeHandler(async (c) => c.json(await state.storageUsage.computeUsage())),
  );

  app.post(
    "/storage/cleanup",
    routeHandler(async (c) => {
      const body = storageCleanupRequestSchema.parse(await c.req.json());
      return c.json(await state.storageUsage.cleanup(body));
    }),
  );

  return app;
}
