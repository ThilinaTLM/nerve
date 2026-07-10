import { storageCleanupRequestSchema } from "@nervekit/contracts";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { routeHandler } from "../http/responses.js";

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
  app.get(
    "/storage/cleanup",
    routeHandler(async (c) =>
      c.json({ operation: state.storageCleanup.get() }),
    ),
  );
  app.get(
    "/storage/cleanup/:id",
    routeHandler(async (c) =>
      c.json({ operation: state.storageCleanup.get(c.req.param("id")) }),
    ),
  );
  app.post(
    "/storage/cleanup",
    routeHandler(async (c) => {
      const body = storageCleanupRequestSchema.parse(await c.req.json());
      return c.json({ operation: await state.storageCleanup.start(body) }, 202);
    }),
  );
  app.post(
    "/storage/cleanup/:id/cancel",
    routeHandler(async (c) =>
      c.json({
        operation: await state.storageCleanup.cancel(
          c.req.param("id") as string,
        ),
      }),
    ),
  );

  return app;
}
