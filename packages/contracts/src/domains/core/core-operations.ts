import { z } from "zod";
import { conversationAgentUsageSchema } from "./conversation-usage.js";
import {
  asyncBashLogsRequestSchema,
  asyncBashLogsResponseSchema,
} from "./async-bash.js";
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
import { leadSettingsOverridesSchema } from "../agent-configuration/schemas.js";
import {
  getAgentConfigurationRequestSchema,
  getAgentConfigurationResultSchema,
  saveAgentConfigurationRequestSchema,
  saveAgentConfigurationResultSchema,
  getEffectiveAgentRequestSchema,
  effectiveAgentViewResultSchema,
  resolveProjectAgentRequestSchema,
  projectAgentDefaultsResultSchema,
  getCreationPreferencesRequestSchema,
  getCreationPreferencesResultSchema,
  saveCreationPreferencesRequestSchema,
  saveCreationPreferencesResultSchema,
  setConversationAgentProfileRequestSchema,
  profileTransitionResultSchema,
  previewProfileTransitionRequestSchema,
  previewProfileTransitionResultSchema,
  interactionResolveResultSchema,
  profileTargetSchema,
} from "../agent-configuration/agent-configuration-operations.js";
export { setConversationAgentProfileRequestSchema } from "../agent-configuration/agent-configuration-operations.js";
export type { SetConversationAgentProfileRequest } from "../agent-configuration/agent-configuration-operations.js";

export const createConversationRequestSchema = z.strictObject({
  id: z.string(),
  projectId: z.string(),
  parentConversationId: z.string().nullable().optional(),
  title: z.string(),
  config: conversationConfigSchema
    .pick({ systemPrompt: true, instructions: true, workingDirectory: true })
    .partial()
    .strict(),
  overrides: leadSettingsOverridesSchema.optional(),
  agentProfile: profileTargetSchema.optional(),
});
export const listConversationsRequestSchema = z.object({
  projectId: z.string(),
  parentConversationId: z.string().nullable().optional(),
});
export const configureConversationRequestSchema = z
  .object({
    conversationId: z.string(),
    // Only SQL-owned context is editable here; agent choices use agentConfiguration.save.
    patch: conversationConfigSchema
      .pick({ systemPrompt: true, instructions: true, workingDirectory: true })
      .partial()
      .strict(),
  })
  .strict();

export const updateConversationRequestSchema = z.object({
  conversationId: z.string(),
  patch: z.object({
    title: z.string().optional(),
    pinned: z.boolean().optional(),
    completed: z.boolean().optional(),
    clearStatus: z.boolean().optional(),
  }),
});
/** Configuration-blocked retry/cancel uses this same idempotent command. A
 * retry is admission re-evaluation, never an approval or permission override. */
export const resolveInteractionRequestSchema = z.strictObject({
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
  "conversation.getUsage": {
    params: conversationId,
    result: conversationAgentUsageSchema,
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
  "conversation.setAgentProfile": {
    params: setConversationAgentProfileRequestSchema,
    result: profileTransitionResultSchema,
  },
  "conversation.previewAgentProfile": {
    params: previewProfileTransitionRequestSchema,
    result: previewProfileTransitionResultSchema,
  },
  "agentConfiguration.get": {
    params: getAgentConfigurationRequestSchema,
    result: getAgentConfigurationResultSchema,
  },
  "agentConfiguration.save": {
    params: saveAgentConfigurationRequestSchema,
    result: saveAgentConfigurationResultSchema,
  },
  "agentConfiguration.getEffective": {
    params: getEffectiveAgentRequestSchema,
    result: effectiveAgentViewResultSchema,
  },
  "agentConfiguration.resolveProject": {
    params: resolveProjectAgentRequestSchema,
    result: projectAgentDefaultsResultSchema,
  },
  "conversationDefaults.get": {
    params: getCreationPreferencesRequestSchema,
    result: getCreationPreferencesResultSchema,
  },
  "conversationDefaults.save": {
    params: saveCreationPreferencesRequestSchema,
    result: saveCreationPreferencesResultSchema,
  },
  "conversation.update": {
    params: updateConversationRequestSchema,
    result: done,
  },
  "conversation.selectHead": {
    params: conversationId.extend({ eventId: z.string().nullable() }),
    result: done,
  },
  /** Accepts a manual compaction request; completion is observed through compaction notifications. */
  "conversation.compact": { params: conversationId, result: done },
  /** Cancels a queued, not yet running, manual compaction request. */
  "conversation.cancelCompaction": { params: conversationId, result: done },
  "conversation.delete": { params: conversationId, result: done },
  "conversation.pause": { params: conversationId, result: done },
  "conversation.resume": { params: conversationId, result: done },
  "conversation.stop": { params: conversationId, result: done },
  "conversation.retryResponse": { params: conversationId, result: done },
  "conversation.forcePush": { params: conversationId, result: done },
  "conversation.continue": { params: conversationId, result: done },
  "input.submit": { params: submitInputRequestSchema, result: done },
  "input.cancel": { params: z.object({ inputId: z.string() }), result: done },
  "interaction.resolve": {
    params: resolveInteractionRequestSchema,
    result: interactionResolveResultSchema,
  },
  "asyncBash.logs": {
    params: asyncBashLogsRequestSchema,
    result: asyncBashLogsResponseSchema,
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
