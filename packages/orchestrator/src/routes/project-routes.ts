import {
  createPinnedCommandRequestSchema,
  createProjectRequestSchema,
  openProjectInEditorRequestSchema,
  pruneProjectConversationsRequestSchema,
  updatePinnedCommandRequestSchema,
} from "@nervekit/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";
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
        project: state.registry.getProject(routeParam(c, "projectId")),
      }),
    ),
  );
  app.post(
    "/:projectId/open-editor",
    routeHandler(async (c) => {
      const body = openProjectInEditorRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.openProjectInEditor(
          routeParam(c, "projectId"),
          body,
        ),
      );
    }),
  );
  app.post(
    "/:projectId/conversations/prune",
    routeHandler(async (c) => {
      const body = pruneProjectConversationsRequestSchema.parse(
        await c.req.json(),
      );
      return c.json(
        await state.registry.pruneProjectConversations(
          routeParam(c, "projectId"),
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
          routeParam(c, "projectId"),
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
            routeParam(c, "projectId"),
            body,
          ),
        },
        201,
      );
    }),
  );
  app.patch(
    "/:projectId/pinned-commands/:commandId",
    routeHandler(async (c) => {
      const body = updatePinnedCommandRequestSchema.parse(await c.req.json());
      return c.json({
        command: await state.registry.updatePinnedCommand(
          routeParam(c, "projectId"),
          routeParam(c, "commandId"),
          body,
        ),
      });
    }),
  );
  app.delete(
    "/:projectId/pinned-commands/:commandId",
    routeHandler(async (c) => {
      await state.registry.removePinnedCommand(
        routeParam(c, "projectId"),
        routeParam(c, "commandId"),
      );
      return c.body(null, 204);
    }),
  );
  app.delete(
    "/:projectId",
    routeHandler(async (c) => {
      await state.registry.removeProject(routeParam(c, "projectId"));
      return c.body(null, 204);
    }),
  );

  return app;
}
