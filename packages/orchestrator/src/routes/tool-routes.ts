import {
  answerUserQuestionRequestSchema,
  dismissUserQuestionRequestSchema,
  planReviewStatusSchema,
  resolveApprovalRequestSchema,
  resolvePlanReviewRequestSchema,
  userQuestionStatusSchema,
} from "@nervekit/shared";
import { Hono } from "hono";
import { toToolCallTranscriptRecord } from "../domains/tools/tool-call-transcript-preview.js";
import { routeHandler } from "../http/responses.js";
import { routeParam } from "../http/route-params.js";
import type { OrchestratorState } from "../server.js";

export function createToolRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get("/tools", (c) => c.json({ tools: state.registry.tools.listTools() }));
  app.get("/tool-calls", (c) =>
    c.json({
      toolCalls: state.registry.tools
        .listToolCalls()
        .map(toToolCallTranscriptRecord),
    }),
  );
  app.get(
    "/tool-calls/:toolCallId",
    routeHandler(async (c) =>
      c.json({
        toolCall: state.registry.tools.getToolCall(routeParam(c, "toolCallId")),
      }),
    ),
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
          routeParam(c, "approvalId"),
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
          routeParam(c, "approvalId"),
          body.note,
        ),
      });
    }),
  );

  app.get("/user-questions", (c) => {
    const status = userQuestionStatusSchema.safeParse(c.req.query("status"));
    return c.json({
      questions: state.registry.listUserQuestions(
        status.success ? status.data : undefined,
      ),
    });
  });
  app.post(
    "/user-questions/:questionId/answer",
    routeHandler(async (c) => {
      const body = answerUserQuestionRequestSchema.parse(await c.req.json());
      return c.json({
        question: await state.registry.answerUserQuestion(
          routeParam(c, "questionId"),
          body.answer,
        ),
      });
    }),
  );
  app.post(
    "/user-questions/:questionId/dismiss",
    routeHandler(async (c) => {
      const body = dismissUserQuestionRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        question: await state.registry.dismissUserQuestion(
          routeParam(c, "questionId"),
          body.reason,
        ),
      });
    }),
  );

  app.get("/plan-reviews", (c) => {
    const status = planReviewStatusSchema.safeParse(c.req.query("status"));
    return c.json({
      planReviews: state.registry.listPlanReviews(
        status.success ? status.data : undefined,
      ),
    });
  });
  app.post(
    "/plan-reviews/:reviewId/accept",
    routeHandler(async (c) => {
      const body = resolvePlanReviewRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        planReview: await state.registry.acceptPlanReview(
          routeParam(c, "reviewId"),
          body.feedback,
          {
            implementationModel: body.implementationModel,
            implementationThinkingLevel: body.implementationThinkingLevel,
          },
        ),
      });
    }),
  );
  app.post(
    "/plan-reviews/:reviewId/accept-in-new-chat",
    routeHandler(async (c) => {
      const body = resolvePlanReviewRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json(
        await state.registry.acceptPlanReviewInNewChat(
          routeParam(c, "reviewId"),
          body.feedback,
          {
            implementationModel: body.implementationModel,
            implementationThinkingLevel: body.implementationThinkingLevel,
          },
        ),
      );
    }),
  );
  app.post(
    "/plan-reviews/:reviewId/reject",
    routeHandler(async (c) => {
      const body = resolvePlanReviewRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        planReview: await state.registry.rejectPlanReview(
          routeParam(c, "reviewId"),
          body.feedback,
        ),
      });
    }),
  );
  app.post(
    "/plan-reviews/:reviewId/request-changes",
    routeHandler(async (c) => {
      const body = resolvePlanReviewRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        planReview: await state.registry.requestPlanChanges(
          routeParam(c, "reviewId"),
          body.feedback,
        ),
      });
    }),
  );
  app.post(
    "/plan-reviews/:reviewId/discard",
    routeHandler(async (c) => {
      const body = resolvePlanReviewRequestSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      return c.json({
        planReview: await state.registry.discardPlanReview(
          routeParam(c, "reviewId"),
          body.feedback,
        ),
      });
    }),
  );

  return app;
}
