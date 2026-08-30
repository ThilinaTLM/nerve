import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type FilesystemContentRoutesContext =
  ServerAdapterContexts["http"]["filesystem"];
import {
  fileContent,
  saveClipboardImage,
} from "../../../domains/filesystem/filesystem.service.js";
import { routeHandler } from "../responses.js";

export function createFilesystemContentRoutes(
  state: FilesystemContentRoutesContext,
): Hono {
  const app = new Hono();
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
          (projectId) => state.projectLifecycle.getProject(projectId).dir,
        ),
      ),
    ),
  );
  app.post(
    "/filesystem/clipboard-image",
    routeHandler(async (c) =>
      c.json(
        await saveClipboardImage(await c.req.json(), state.storage.paths.home),
      ),
    ),
  );
  return app;
}
