import { resolveApprovalRequestSchema } from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

export function createToolRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/tools", (c) => c.json({ tools: state.registry.tools.listTools() }));
  app.get("/tool-calls", (c) =>
    c.json({ toolCalls: state.registry.tools.listToolCalls() }),
  );
  app.get("/approvals", (c) => {
    const status = c.req.query("status");
    return c.json({
      approvals: state.registry.tools.listApprovals(
        status === "pending" || status === "granted" || status === "denied"
          ? status
          : undefined,
      ),
    });
  });
  app.post(
    "/approvals/:approvalId/grant",
    routeHandler(async (c) => {
      const body = resolveApprovalRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        toolCall: await state.registry.grantApproval(
          c.req.param("approvalId"),
          body.note,
        ),
      });
    }),
  );
  app.post(
    "/approvals/:approvalId/deny",
    routeHandler(async (c) => {
      const body = resolveApprovalRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        toolCall: await state.registry.denyApproval(
          c.req.param("approvalId"),
          body.note,
        ),
      });
    }),
  );

  return app;
}
