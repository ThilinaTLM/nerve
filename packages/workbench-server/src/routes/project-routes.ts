import {
  createProjectRequestSchema,
  createTaskDefinitionRequestSchema,
  openProjectInEditorRequestSchema,
  openProjectInTerminalRequestSchema,
  pruneProjectConversationsRequestSchema,
  updateTaskDefinitionRequestSchema,
} from "@nervekit/contracts";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

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
    "/:projectId/icon",
    routeHandler(async (c) => {
      const icon = await state.registry.projectIcons.get(
        routeParam(c, "projectId"),
      );
      const cacheHeaders = {
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      };
      if (!icon) {
        return c.body(null, 404, {
          ...cacheHeaders,
          "Cache-Control": "private, no-cache",
        });
      }
      if (c.req.header("if-none-match") === icon.etag) {
        return c.body(null, 304, { ...cacheHeaders, ETag: icon.etag });
      }
      return c.body(new Uint8Array(icon.buffer), 200, {
        ...cacheHeaders,
        "Content-Type": icon.mimeType,
        ETag: icon.etag,
      });
    }),
  );
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
    "/:projectId/open-terminal",
    routeHandler(async (c) => {
      const body = openProjectInTerminalRequestSchema.parse(await c.req.json());
      return c.json(
        await state.registry.openProjectInTerminal(
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
    "/:projectId/task-definitions",
    routeHandler(async (c) =>
      c.json({
        definitions: await state.registry.listTaskDefinitions(
          routeParam(c, "projectId"),
        ),
      }),
    ),
  );
  app.post(
    "/:projectId/task-definitions",
    routeHandler(async (c) => {
      const body = createTaskDefinitionRequestSchema.parse(await c.req.json());
      return c.json(
        {
          definition: await state.registry.createTaskDefinition(
            routeParam(c, "projectId"),
            body,
          ),
        },
        201,
      );
    }),
  );
  app.patch(
    "/:projectId/task-definitions/:definitionId",
    routeHandler(async (c) => {
      const body = updateTaskDefinitionRequestSchema.parse(await c.req.json());
      return c.json({
        definition: await state.registry.updateTaskDefinition(
          routeParam(c, "projectId"),
          routeParam(c, "definitionId"),
          body,
        ),
      });
    }),
  );
  app.delete(
    "/:projectId/task-definitions/:definitionId",
    routeHandler(async (c) => {
      await state.registry.removeTaskDefinition(
        routeParam(c, "projectId"),
        routeParam(c, "definitionId"),
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
