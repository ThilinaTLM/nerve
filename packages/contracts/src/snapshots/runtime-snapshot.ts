import { z } from "zod";
import { agentRecordSchema } from "../domains/agents/agent.js";
import { conversationRecordSchema } from "../domains/conversations/conversation-state.js";
import { conversationSnapshotSchema } from "../domains/conversations/live-state.js";
import { projectRecordSchema } from "../domains/projects/project.js";
import { taskRecordSchema } from "../domains/tasks/task.js";
import { toolCallTranscriptRecordSchema } from "../domains/tools/records.js";
import { streamCursorSchema } from "../wire/event-stream.js";

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
    generatedAt: z.string().datetime(),
  });
}

export const workspaceSnapshotSchema = z.object({
  projects: z.array(projectRecordSchema),
  conversations: z.array(conversationRecordSchema),
  agents: z.array(agentRecordSchema),
  tasks: z.array(taskRecordSchema),
  pendingToolCalls: z.array(toolCallTranscriptRecordSchema),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export const workspaceSnapshotResponseSchema = snapshotResponseSchema(
  workspaceSnapshotSchema,
);
export type WorkspaceSnapshotResponse = z.infer<
  typeof workspaceSnapshotResponseSchema
>;

export const conversationSnapshotResponseSchema = snapshotResponseSchema(
  conversationSnapshotSchema,
);
export type ConversationSnapshotResponse<TSnapshot = unknown> = {
  snapshot: TSnapshot;
  cursor: SnapshotCursor;
  generatedAt: string;
};
