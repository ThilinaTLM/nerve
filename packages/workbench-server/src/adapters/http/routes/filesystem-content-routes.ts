import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  ATTACHMENT_MAX_BYTES,
  FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES,
} from "@nervekit/contracts/filesystem";
import { ApplicationError } from "../../../core/application-error.js";
import { uploadProjectFiles } from "../../../domains/filesystem/project-entry-mutations.js";
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
  app.post(
    "/filesystem/project/upload",
    bodyLimit({
      maxSize: FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES + 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "UPLOAD_TOO_LARGE",
              message: "The upload is too large.",
            },
          },
          413,
        ),
    }),
    routeHandler(async (c) => {
      const form = await c.req.formData().catch(() => {
        throw new ApplicationError(
          400,
          "INVALID_UPLOAD",
          "Expected a multipart/form-data upload.",
        );
      });
      const projectId = form.get("projectId");
      const path = form.get("path");
      if (typeof projectId !== "string" || !projectId)
        throw new ApplicationError(400, "INVALID_UPLOAD", "Missing projectId.");
      const files = form
        .getAll("files")
        .filter((value): value is File => typeof value !== "string");
      return c.json(
        await uploadProjectFiles(
          {
            projectId,
            path: typeof path === "string" ? path : "",
            overwrite: form.get("overwrite") === "true",
            files: files.map((file) => ({
              name: file.name,
              size: file.size,
              bytes: async () => new Uint8Array(await file.arrayBuffer()),
            })),
          },
          (id) => state.getProject(id).directory,
        ),
      );
    }),
  );
  return app;
}
