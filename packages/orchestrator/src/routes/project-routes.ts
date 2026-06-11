import {
  createPinnedCommandRequestSchema,
  createProjectRequestSchema,
  pruneProjectConversationsRequestSchema,
} from "@nerve/shared";
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
  app.post(
    "/:projectId/conversations/prune",
    routeHandler(async (c) => {
      const body = pruneProjectConversationsRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.pruneProjectConversations(
          c.req.param("projectId"),
          body,
        ),
      );
    }),
  );
  app.get(
    "/:projectId/pinned-commands",
    routeHandler(async (c) =>
      c.json({
        commands: await state.registry.listPinnedCommands(
          c.req.param("projectId"),
        ),
      }),
    ),
  );
  app.post(
    "/:projectId/pinned-commands",
    routeHandler(async (c) => {
      const body = createPinnedCommandRequestSchema.parse(await c.req.json());
      return c.json(
        {
          command: await state.registry.createPinnedCommand(
            c.req.param("projectId"),
            body,
          ),
        },
        201,
      );
    }),
  );
  app.delete(
    "/:projectId/pinned-commands/:commandId",
    routeHandler(async (c) => {
      await state.registry.removePinnedCommand(
        c.req.param("projectId"),
        c.req.param("commandId"),
      );
      return c.body(null, 204);
    }),
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
