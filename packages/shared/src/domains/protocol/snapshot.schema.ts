import { z } from "zod";
import { agentRecordSchema } from "../agents/index.js";
import { conversationRecordSchema } from "../conversations/index.js";
import { planReviewRecordSchema } from "../plans/index.js";
import { projectRecordSchema } from "../projects/index.js";
import { taskRecordSchema } from "../tasks/index.js";
import {
  approvalRecordSchema,
  userQuestionRecordSchema,
} from "../tools/index.js";
import { workerRecordSchema } from "../workers/index.js";
import { streamCursorSchema } from "./event-stream.schema.js";

export const snapshotCursorSchema = z.object({
  streams: z.array(streamCursorSchema),
});
export type SnapshotCursor = z.infer<typeof snapshotCursorSchema>;

export function snapshotResponseSchema<TSchema extends z.ZodType>(
  snapshotSchema: TSchema,
) {
  return z.object({
    snapshot: snapshotSchema,
    cursor: snapshotCursorSchema,
  });
}

export const workspaceSnapshotSchema = z.object({
  projects: z.array(projectRecordSchema),
  conversations: z.array(conversationRecordSchema),
  agents: z.array(agentRecordSchema),
  tasks: z.array(taskRecordSchema),
  approvals: z.array(approvalRecordSchema),
  userQuestions: z.array(userQuestionRecordSchema),
  planReviews: z.array(planReviewRecordSchema),
  workers: z.array(workerRecordSchema).optional(),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export const workspaceSnapshotResponseSchema = snapshotResponseSchema(
  workspaceSnapshotSchema,
);
export type WorkspaceSnapshotResponse = z.infer<
  typeof workspaceSnapshotResponseSchema
>;

export const conversationSnapshotResponseSchema = snapshotResponseSchema(
  z.unknown(),
);
export type ConversationSnapshotResponse<TSnapshot = unknown> = {
  snapshot: TSnapshot;
  cursor: SnapshotCursor;
};
