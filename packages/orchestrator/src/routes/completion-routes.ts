import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

type CompletionItem = {
  label: string;
  detail?: string;
  info?: string;
  kind: "slash" | "file" | "directory";
  apply?: string;
};

const slashCompletionItems: CompletionItem[] = [
  {
    label: "/plan",
    detail: "Start in planning mode",
    info: "Ask the agent to inspect first and produce a short plan before changing files.",
    kind: "slash",
  },
  {
    label: "/code",
    detail: "Switch to implementation",
    info: "Frame the next prompt as a coding task.",
    kind: "slash",
  },
  {
    label: "/status",
    detail: "Summarize current session state",
    info: "Useful before handing off or resuming a durable session.",
    kind: "slash",
  },
  {
    label: "/abort",
    detail: "Stop the active run",
    info: "Cancels the active agent run from the UI.",
    kind: "slash",
  },
];

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function fileCompletionItems(
  state: OrchestratorState,
  projectId: string | undefined,
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  const project = state.registry.getProject(projectId);
  const root = resolve(project.dir);
  const normalizedQuery = query.replace(/^@/, "").replaceAll("\\", "/");
  const directoryPart = normalizedQuery.endsWith("/")
    ? normalizedQuery
    : dirname(normalizedQuery);
  const basePart = normalizedQuery.endsWith("/")
    ? ""
    : basename(normalizedQuery);
  const relativeDirectory = directoryPart === "." ? "" : directoryPart;
  const targetDirectory = resolve(root, relativeDirectory);
  if (!isInside(root, targetDirectory)) return [];

  const entries = await readdir(targetDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) =>
      entry.name.toLowerCase().startsWith(basePart.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 40)
    .map((entry) => {
      const relativePath = join(relativeDirectory, entry.name).replaceAll(
        "\\",
        "/",
      );
      const isDirectory = entry.isDirectory();
      return {
        label: `@${relativePath}${isDirectory ? "/" : ""}`,
        apply: `@${relativePath}${isDirectory ? "/" : ""}`,
        detail: isDirectory ? "folder" : "file",
        info: relativePath,
        kind: isDirectory ? "directory" : "file",
      } satisfies CompletionItem;
    });
}

export function createCompletionRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/completions/slash", (c) => c.json({ items: slashCompletionItems }));
  app.get(
    "/completions/files",
    routeHandler(async (c) =>
      c.json({
        items: await fileCompletionItems(
          state,
          c.req.query("projectId"),
          c.req.query("q") ?? "",
        ),
      }),
    ),
  );

  return app;
}
