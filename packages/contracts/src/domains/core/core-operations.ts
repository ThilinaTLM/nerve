import { z } from "zod";
import { projectSchema } from "./project.js";
import {
  trustedResourceSchema,
  trustedResourceKindSchema,
} from "./trusted-resource.js";
import {
  conversationConfigSchema,
  conversationSnapshotSchema,
  conversationSummarySchema,
} from "./conversation.js";
import {
  transferredConversationEventSchema,
  agentProjectionSchema,
  storedToolResultSchema,
  eventTreeNodeSchema,
} from "./event.js";
import { submitInputRequestSchema } from "./input.js";
import { interactionResolutionSchema } from "./tool-call.js";

export const createConversationRequestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentConversationId: z.string().nullable().optional(),
  title: z.string(),
  config: conversationConfigSchema.omit({ conversationId: true }),
});
export const listConversationsRequestSchema = z.object({
  projectId: z.string(),
  parentConversationId: z.string().nullable().optional(),
});
export const configureConversationRequestSchema = z.object({
  conversationId: z.string(),
  patch: conversationConfigSchema.omit({ conversationId: true }).partial(),
});
export const updateConversationRequestSchema = z.object({
  conversationId: z.string(),
  patch: z.object({
    title: z.string().optional(),
    pinned: z.boolean().optional(),
    completed: z.boolean().optional(),
    clearStatus: z.boolean().optional(),
  }),
});
export const resolveInteractionRequestSchema = z.object({
  toolCallId: z.string(),
  resolutionRequestId: z.string(),
  resolution: interactionResolutionSchema,
});
const conversationId = z.object({ conversationId: z.string() });
const empty = z.object({});
const done = z.null();

// A standalone channel contract, intentionally not part of the legacy operation catalog.
export const coreOperationSchemas = {
  "project.create": {
    params: projectSchema.omit({ createdAt: true, updatedAt: true }),
    result: projectSchema,
  },
  "project.list": { params: empty, result: z.array(projectSchema) },
  "project.get": {
    params: z.object({ projectId: z.string() }),
    result: projectSchema.nullable(),
  },
  "project.update": {
    params: z.object({
      projectId: z.string(),
      patch: projectSchema.pick({ name: true, directory: true }).partial(),
    }),
    result: projectSchema,
  },
  "project.delete": {
    params: z.object({ projectId: z.string() }),
    result: done,
  },
  "trust.list": {
    params: z.object({
      projectId: z.string().nullable(),
      kind: trustedResourceKindSchema.optional(),
    }),
    result: z.array(trustedResourceSchema),
  },
  "trust.decide": {
    params: trustedResourceSchema.omit({ createdAt: true, updatedAt: true }),
    result: trustedResourceSchema,
  },
  "trust.delete": {
    params: z.object({ trustedResourceId: z.string() }),
    result: done,
  },
  "conversation.create": {
    params: createConversationRequestSchema,
    result: conversationSnapshotSchema,
  },
  "conversation.list": {
    params: listConversationsRequestSchema,
    result: z.array(conversationSummarySchema),
  },
  "conversation.getSnapshot": {
    params: conversationId,
    result: conversationSnapshotSchema,
  },
  "conversation.getHistory": {
    params: conversationId.extend({
      beforeEventId: z.string().optional(),
      limit: z.number().int().positive(),
    }),
    result: z.array(transferredConversationEventSchema),
  },
  "toolCall.getDetails": {
    params: conversationId.extend({ toolCallId: z.string() }),
    result: z.object({
      agentProjection: agentProjectionSchema,
      result: storedToolResultSchema,
    }),
  },
  "conversation.getTree": {
    params: conversationId,
    result: z.array(eventTreeNodeSchema),
  },
  "conversation.getEventsSince": {
    params: conversationId.extend({ sequence: z.number().int().nonnegative() }),
    result: z.array(transferredConversationEventSchema),
  },
  "conversation.configure": {
    params: configureConversationRequestSchema,
    result: done,
  },
  "conversation.update": {
    params: updateConversationRequestSchema,
    result: done,
  },
  "conversation.selectHead": {
    params: conversationId.extend({ eventId: z.string().nullable() }),
    result: done,
  },
  "conversation.compact": { params: conversationId, result: done },
  "conversation.delete": { params: conversationId, result: done },
  "conversation.pause": { params: conversationId, result: done },
  "conversation.resume": { params: conversationId, result: done },
  "conversation.stop": { params: conversationId, result: done },
  "conversation.forcePush": { params: conversationId, result: done },
  "conversation.continue": { params: conversationId, result: done },
  "input.submit": { params: submitInputRequestSchema, result: done },
  "input.cancel": { params: z.object({ inputId: z.string() }), result: done },
  "interaction.resolve": {
    params: resolveInteractionRequestSchema,
    result: done,
  },
  "asyncBash.cancel": {
    params: z.object({ bashId: z.string() }),
    result: done,
  },
} as const;
export type CoreOperationName = keyof typeof coreOperationSchemas;
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;
export type ListConversationsRequest = z.infer<
  typeof listConversationsRequestSchema
>;
export type ConfigureConversationRequest = z.infer<
  typeof configureConversationRequestSchema
>;
export type UpdateConversationRequest = z.infer<
  typeof updateConversationRequestSchema
>;
export type ResolveInteractionRequest = z.infer<
  typeof resolveInteractionRequestSchema
>;
