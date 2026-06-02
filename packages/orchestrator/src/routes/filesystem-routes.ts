import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { filesystemDirectoryQuerySchema } from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

async function directoryListing(path: string | undefined, showHidden = false) {
  const target = resolve(path?.trim() || homedir());
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new Error(`${target} is not a directory.`);
  }
  const root = parse(target).root;
  const entries = await readdir(target, { withFileTypes: true });
  return {
    path: target,
    parent: target === root ? undefined : dirname(target),
    entries: entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => showHidden || !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        name: entry.name,
        path: join(target, entry.name),
        kind: "directory" as const,
        hidden: entry.name.startsWith("."),
      })),
  };
}

export function createFilesystemRoutes(_state: OrchestratorState): Hono {
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

  return app;
}
