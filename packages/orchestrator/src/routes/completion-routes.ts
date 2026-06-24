import type { CompletionItem } from "@nervekit/shared";
import { fileCompletionQuerySchema } from "@nervekit/shared";
import { Hono } from "hono";
import { FileCompletionService } from "../domains/completions/index.js";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

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
    detail: "Summarize current conversation state",
    info: "Useful before handing off or resuming a durable conversation.",
    kind: "slash",
  },
  {
    label: "/abort",
    detail: "Stop the active run",
    info: "Cancels the active agent run from the UI.",
    kind: "slash",
  },
];

export function createCompletionRoutes(state: OrchestratorState): Hono {
  const app = new Hono();
  const files = new FileCompletionService((projectId) =>
    state.registry.getProject(projectId),
  );

  app.get("/completions/slash", (c) => c.json({ items: slashCompletionItems }));
  app.get(
    "/completions/files",
    routeHandler(async (c) => {
      const query = fileCompletionQuerySchema.parse({
        projectId: c.req.query("projectId"),
        q: c.req.query("q"),
        limit: c.req.query("limit"),
      });
      return c.json({
        items: await files.completeFiles(query.projectId, query.q, {
          limit: query.limit,
        }),
      });
    }),
  );

  return app;
}
