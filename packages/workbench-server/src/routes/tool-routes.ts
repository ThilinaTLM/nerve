import {
  resolveToolInteractionRequestSchema,
  toolCallStatusSchema,
} from "@nervekit/contracts";
import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";

const MAX_TOOL_CALL_LIST_LIMIT = 1_000;

export function createToolRoutes(state: OrchestratorState): Hono {
  const app = new Hono();
  app.get("/tools", (c) => c.json({ tools: state.registry.tools.listTools() }));
  app.get("/tool-calls", (c) => {
    const status = toolCallStatusSchema.safeParse(c.req.query("status"));
    const pendingKind = c.req.query("pendingInteractionKind");
    const requestedLimit = Number.parseInt(c.req.query("limit") ?? "", 10);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_TOOL_CALL_LIST_LIMIT)
        : undefined;
    const cursorUpdatedAt = c.req.query("cursorUpdatedAt");
    const cursorId = c.req.query("cursorId");
    const page = state.registry.tools.queryToolCallPreviews({
      status: status.success ? status.data : undefined,
      pendingInteractionKind:
        pendingKind === "approval" ||
        pendingKind === "user_input" ||
        pendingKind === "plan_review"
          ? pendingKind
          : undefined,
      limit,
      cursor:
        cursorUpdatedAt && cursorId
          ? { updatedAt: cursorUpdatedAt, id: cursorId }
          : undefined,
    });
    return c.json(page);
  });
  app.get(
    "/tool-calls/:toolCallId",
    routeHandler(async (c) =>
      c.json({
        toolCall: await state.registry.tools.getToolCallDetails(
          routeParam(c, "toolCallId"),
        ),
      }),
    ),
  );
  app.post(
    "/tool-calls/:toolCallId/interactions/:ordinal/resolve",
    routeHandler(async (c) => {
      const body = await c.req.json();
      const request = resolveToolInteractionRequestSchema.parse({
        ...body,
        toolCallId: routeParam(c, "toolCallId"),
        interactionOrdinal: Number.parseInt(routeParam(c, "ordinal"), 10),
      });
      return c.json(await state.registry.resolveToolInteraction(request));
    }),
  );
  return app;
}
