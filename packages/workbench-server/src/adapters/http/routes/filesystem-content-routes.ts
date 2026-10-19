import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ATTACHMENT_MAX_BYTES } from "@nervekit/contracts/filesystem";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
type FilesystemContentRoutesContext =
  ServerAdapterContexts["http"]["filesystem"];
import {
  fileContent,
  saveAttachment,
  saveFileContent,
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
          (projectId) => state.getProject(projectId).directory,
        ),
      ),
    ),
  );
  app.put(
    "/filesystem/file",
    routeHandler(async (c) =>
      c.json(
        await saveFileContent(
          await c.req.json(),
          (projectId) => state.getProject(projectId).directory,
        ),
      ),
    ),
  );
  app.post(
    "/filesystem/attachment",
    bodyLimit({
      maxSize: Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 + 8192,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "ATTACHMENT_TOO_LARGE",
              message: "Attachments must be 20 MiB or smaller.",
            },
          },
          413,
        ),
    }),
    routeHandler(async (c) =>
      c.json(
        await saveAttachment(await c.req.json(), state.storage.paths.home),
      ),
    ),
  );
  return app;
}
