import { filesystemDirectoryQuerySchema } from "@nervekit/contracts";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import {
  directoryListing,
  fileContent,
  saveClipboardImage,
} from "../domains/filesystem/filesystem.service.js";
import { routeHandler } from "../http/responses.js";

export function createFilesystemRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get(
    "/filesystem/directories",
    routeHandler(async (c) => {
      const query = filesystemDirectoryQuerySchema.parse({
        path: c.req.query("path"),
        showHidden: c.req.query("showHidden"),
      });
      return c.json(await directoryListing(query.path, query.showHidden));
    }),
  );

  app.get(
    "/filesystem/file",
    routeHandler(async (c) =>
      c.json(
        await fileContent(
          {
            projectId: c.req.query("projectId"),
            path: c.req.query("path"),
            line: c.req.query("line"),
          },
          (projectId) => state.registry.getProject(projectId).dir,
        ),
      ),
    ),
  );

  app.post(
    "/filesystem/clipboard-image",
    routeHandler(async (c) =>
      c.json(await saveClipboardImage(await c.req.json())),
    ),
  );

  return app;
}
