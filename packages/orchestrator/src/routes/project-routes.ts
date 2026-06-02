import { createProjectRequestSchema } from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createProjectRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.post(
    "/",
    routeHandler(async (c) => {
      const body = createProjectRequestSchema.parse(await c.req.json());
      return c.json({ project: await state.registry.createProject(body) }, 201);
    }),
  );
  app.get("/", (c) => c.json({ projects: state.registry.listProjects() }));
  app.get(
    "/:projectId",
    routeHandler((c) =>
      c.json({
        project: state.registry.getProject(c.req.param("projectId")),
      }),
    ),
  );
  app.delete(
    "/:projectId",
    routeHandler(async (c) => {
      await state.registry.removeProject(c.req.param("projectId"));
      return c.body(null, 204);
    }),
  );

  return app;
}
