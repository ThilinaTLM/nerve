import { appliedAgentProfileSchema } from "../agent-profiles/applied-agent-profile.js";
import { compactionOperationSchema } from "./compaction-operation.js";
/**
 * /ws/conversations: coreOperationSchemas plus model.list, permissionRuleSet.list,
 * skill.list, tool.list and completion.slash.list. Capabilities are operation.<name>.
 * conversation.event carries a full ConversationEvent on conv/<conversationId>;
 * envelope seq equals event.sequence. Durable replay resumes after the acknowledged seq.
 * conversation.changed/deleted are project-scoped list notices; head/config/toolCall/
 * queue/asyncBash/live notices are conversation-scoped, ephemeral and never replayed.
 * Reconnect re-fetches project lists and conversation snapshots; live state starts empty.
 * These arrays are standalone until cutover registers them in the normal catalogs.
 */
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { defineContentEvent } from "../../events/definition.js";
import { modelInfoSchema } from "../models/models.js";
import {
  permissionPolicyConfigurationSchema,
  permissionRuleSchema,
  permissionRuleSetIdSchema,
  permissionRuleSetSchema,
} from "../permissions/permission-rule-sets.js";
import { availableSkillsResponseSchema } from "../skills/skill.js";
import { toolDescriptorSchema } from "../tools/records.js";
import { completionItemSchema } from "../completions/completion.js";
import { coreOperationSchemas } from "./core-operations.js";
import { transferredConversationEventSchema } from "./event.js";
import {
  conversationConfigSchema,
  conversationHistoryConfigSchema,
  conversationSummarySchema,
} from "./conversation.js";
import { toolCallSchema } from "./tool-call.js";
import { queuedInputSchema } from "./input.js";
import { asyncBashSchema } from "./async-bash.js";
import { liveDeltaSchema } from "./live.js";

import {
  leadSettingsOverridesSchema,
  agentResolutionSchema,
} from "../agent-configuration/schemas.js";
import {
  agentScopeSchema,
  preferenceScopeSchema,
  profileTargetSchema,
  configurationUnavailableSchema,
} from "../agent-configuration/agent-configuration-operations.js";

export const previewSystemPromptParamsSchema = z.union([
  z.strictObject({ conversationId: z.string().min(1) }),
  z.strictObject({
    projectId: z.string().min(1),
    overrides: leadSettingsOverridesSchema,
    agentProfile: profileTargetSchema.optional(),
    config: conversationConfigSchema
      .pick({ systemPrompt: true, instructions: true, workingDirectory: true })
      .partial()
      .strict()
      .optional(),
  }),
]);
export const previewSystemPromptResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    systemPrompt: z.string(),
    resolution: agentResolutionSchema,
  }),
  configurationUnavailableSchema,
]);
export type PreviewSystemPromptResult = z.infer<
  typeof previewSystemPromptResultSchema
>;
export type PreviewSystemPromptParams = z.infer<
  typeof previewSystemPromptParamsSchema
>;

const emptyParams = z.object({}).optional();
const host = ["workbench_server"] as const;

const permissionRuleTarget = z.object({
  /** Overlay file to edit; conversation overlays are written by approvals only. */
  scope: z.enum(["user", "project"]),
  /** Required for project scope and used to report project overlays and trust. */
  projectId: z.string().optional(),
  ruleSetId: permissionRuleSetIdSchema,
});

export const conversationChannelOperations = [
  defineOperation(
    "agentConfiguration.get",
    coreOperationSchemas["agentConfiguration.get"].params,
    coreOperationSchemas["agentConfiguration.get"].result,
    "read",
    "none",
    host,
    "operation.agentConfiguration.get",
  ),
  defineOperation(
    "agentConfiguration.save",
    coreOperationSchemas["agentConfiguration.save"].params,
    coreOperationSchemas["agentConfiguration.save"].result,
    "mutation",
    "none",
    host,
    "operation.agentConfiguration.save",
  ),
  defineOperation(
    "agentConfiguration.getEffective",
    coreOperationSchemas["agentConfiguration.getEffective"].params,
    coreOperationSchemas["agentConfiguration.getEffective"].result,
    "read",
    "none",
    host,
    "operation.agentConfiguration.getEffective",
  ),
  defineOperation(
    "conversationDefaults.get",
    coreOperationSchemas["conversationDefaults.get"].params,
    coreOperationSchemas["conversationDefaults.get"].result,
    "read",
    "none",
    host,
    "operation.conversationDefaults.get",
  ),
  defineOperation(
    "conversationDefaults.save",
    coreOperationSchemas["conversationDefaults.save"].params,
    coreOperationSchemas["conversationDefaults.save"].result,
    "mutation",
    "none",
    host,
    "operation.conversationDefaults.save",
  ),
  defineOperation(
    "conversation.previewAgentProfile",
    coreOperationSchemas["conversation.previewAgentProfile"].params,
    coreOperationSchemas["conversation.previewAgentProfile"].result,
    "read",
    "none",
    host,
    "operation.conversation.previewAgentProfile",
  ),
  defineOperation(
    "toolCall.getDetails",
    coreOperationSchemas["toolCall.getDetails"].params,
    coreOperationSchemas["toolCall.getDetails"].result,
    "read",
    "none",
    host,
    "operation.toolCall.getDetails",
  ),
  defineOperation(
    "project.create",
    coreOperationSchemas["project.create"].params,
    coreOperationSchemas["project.create"].result,
    "mutation",
    "none",
    host,
    "operation.project.create",
  ),
  defineOperation(
    "project.list",
    coreOperationSchemas["project.list"].params,
    coreOperationSchemas["project.list"].result,
    "read",
    "none",
    host,
    "operation.project.list",
  ),
  defineOperation(
    "project.get",
    coreOperationSchemas["project.get"].params,
    coreOperationSchemas["project.get"].result,
    "read",
    "none",
    host,
    "operation.project.get",
  ),
  defineOperation(
    "project.update",
    coreOperationSchemas["project.update"].params,
    coreOperationSchemas["project.update"].result,
    "mutation",
    "none",
    host,
    "operation.project.update",
  ),
  defineOperation(
    "project.delete",
    coreOperationSchemas["project.delete"].params,
    coreOperationSchemas["project.delete"].result,
    "mutation",
    "none",
    host,
    "operation.project.delete",
  ),
  defineOperation(
    "trust.list",
    coreOperationSchemas["trust.list"].params,
    coreOperationSchemas["trust.list"].result,
    "read",
    "none",
    host,
    "operation.trust.list",
  ),
  defineOperation(
    "trust.decide",
    coreOperationSchemas["trust.decide"].params,
    coreOperationSchemas["trust.decide"].result,
    "mutation",
    "none",
    host,
    "operation.trust.decide",
  ),
  defineOperation(
    "trust.delete",
    coreOperationSchemas["trust.delete"].params,
    coreOperationSchemas["trust.delete"].result,
    "mutation",
    "none",
    host,
    "operation.trust.delete",
  ),
  defineOperation(
    "conversation.create",
    coreOperationSchemas["conversation.create"].params,
    coreOperationSchemas["conversation.create"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.create",
  ),
  defineOperation(
    "conversation.list",
    coreOperationSchemas["conversation.list"].params,
    coreOperationSchemas["conversation.list"].result,
    "read",
    "none",
    host,
    "operation.conversation.list",
  ),
  defineOperation(
    "conversation.getSnapshot",
    coreOperationSchemas["conversation.getSnapshot"].params,
    coreOperationSchemas["conversation.getSnapshot"].result,
    "read",
    "none",
    host,
    "operation.conversation.getSnapshot",
  ),
  defineOperation(
    "conversation.getUsage",
    coreOperationSchemas["conversation.getUsage"].params,
    coreOperationSchemas["conversation.getUsage"].result,
    "read",
    "none",
    host,
    "operation.conversation.getUsage",
  ),
  defineOperation(
    "conversation.previewSystemPrompt",
    previewSystemPromptParamsSchema,
    previewSystemPromptResultSchema,
    "read",
    "none",
    host,
    "operation.conversation.previewSystemPrompt",
  ),
  defineOperation(
    "conversation.getHistory",
    coreOperationSchemas["conversation.getHistory"].params,
    coreOperationSchemas["conversation.getHistory"].result,
    "read",
    "none",
    host,
    "operation.conversation.getHistory",
  ),
  defineOperation(
    "conversation.getTree",
    coreOperationSchemas["conversation.getTree"].params,
    coreOperationSchemas["conversation.getTree"].result,
    "read",
    "none",
    host,
    "operation.conversation.getTree",
  ),
  defineOperation(
    "conversation.getEventsSince",
    coreOperationSchemas["conversation.getEventsSince"].params,
    coreOperationSchemas["conversation.getEventsSince"].result,
    "read",
    "none",
    host,
    "operation.conversation.getEventsSince",
  ),
  defineOperation(
    "conversation.setAgentProfile",
    coreOperationSchemas["conversation.setAgentProfile"].params,
    coreOperationSchemas["conversation.setAgentProfile"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.setAgentProfile",
  ),
  defineOperation(
    "conversation.configure",
    coreOperationSchemas["conversation.configure"].params,
    coreOperationSchemas["conversation.configure"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.configure",
  ),
  defineOperation(
    "conversation.update",
    coreOperationSchemas["conversation.update"].params,
    coreOperationSchemas["conversation.update"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.update",
  ),
  defineOperation(
    "conversation.selectHead",
    coreOperationSchemas["conversation.selectHead"].params,
    coreOperationSchemas["conversation.selectHead"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.selectHead",
  ),
  defineOperation(
    "conversation.compact",
    coreOperationSchemas["conversation.compact"].params,
    coreOperationSchemas["conversation.compact"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.compact",
  ),
  defineOperation(
    "conversation.cancelCompaction",
    coreOperationSchemas["conversation.cancelCompaction"].params,
    coreOperationSchemas["conversation.cancelCompaction"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.cancelCompaction",
  ),
  defineOperation(
    "conversation.delete",
    coreOperationSchemas["conversation.delete"].params,
    coreOperationSchemas["conversation.delete"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.delete",
  ),
  defineOperation(
    "conversation.pause",
    coreOperationSchemas["conversation.pause"].params,
    coreOperationSchemas["conversation.pause"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.pause",
  ),
  defineOperation(
    "conversation.resume",
    coreOperationSchemas["conversation.resume"].params,
    coreOperationSchemas["conversation.resume"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.resume",
  ),
  defineOperation(
    "conversation.retryResponse",
    coreOperationSchemas["conversation.retryResponse"].params,
    coreOperationSchemas["conversation.retryResponse"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.retryResponse",
  ),
  defineOperation(
    "conversation.stop",
    coreOperationSchemas["conversation.stop"].params,
    coreOperationSchemas["conversation.stop"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.stop",
  ),
  defineOperation(
    "conversation.forcePush",
    coreOperationSchemas["conversation.forcePush"].params,
    coreOperationSchemas["conversation.forcePush"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.forcePush",
  ),
  defineOperation(
    "conversation.continue",
    coreOperationSchemas["conversation.continue"].params,
    coreOperationSchemas["conversation.continue"].result,
    "mutation",
    "none",
    host,
    "operation.conversation.continue",
  ),
  defineOperation(
    "input.submit",
    coreOperationSchemas["input.submit"].params,
    coreOperationSchemas["input.submit"].result,
    "mutation",
    "none",
    host,
    "operation.input.submit",
  ),
  defineOperation(
    "input.cancel",
    coreOperationSchemas["input.cancel"].params,
    coreOperationSchemas["input.cancel"].result,
    "mutation",
    "none",
    host,
    "operation.input.cancel",
  ),
  defineOperation(
    "interaction.resolve",
    coreOperationSchemas["interaction.resolve"].params,
    coreOperationSchemas["interaction.resolve"].result,
    "mutation",
    "none",
    host,
    "operation.interaction.resolve",
  ),
  defineOperation(
    "asyncBash.logs",
    coreOperationSchemas["asyncBash.logs"].params,
    coreOperationSchemas["asyncBash.logs"].result,
    "read",
    "none",
    host,
    "operation.asyncBash.logs",
  ),
  defineOperation(
    "asyncBash.cancel",
    coreOperationSchemas["asyncBash.cancel"].params,
    coreOperationSchemas["asyncBash.cancel"].result,
    "mutation",
    "none",
    host,
    "operation.asyncBash.cancel",
  ),
  defineOperation(
    "model.list",
    emptyParams,
    z.object({ models: z.array(modelInfoSchema) }),
    "read",
    "none",
    host,
    "operation.model.list",
  ),
  defineOperation(
    "permissionRuleSet.list",
    emptyParams,
    z.object({ ruleSets: z.array(permissionRuleSetSchema) }),
    "read",
    "none",
    host,
    "operation.permissionRuleSet.list",
  ),
  defineOperation(
    "permission.configuration.get",
    z.object({ projectId: z.string().optional() }).optional(),
    permissionPolicyConfigurationSchema,
    "read",
    "none",
    host,
    "operation.permission.configuration.get",
  ),
  defineOperation(
    "permission.rule.save",
    permissionRuleTarget.extend({
      /** Existing rule ID being edited; omit to add a rule. */
      previousRuleId: z.string().optional(),
      rule: permissionRuleSchema,
    }),
    permissionPolicyConfigurationSchema,
    "mutation",
    "none",
    host,
    "operation.permission.rule.save",
  ),
  defineOperation(
    "permission.rule.delete",
    permissionRuleTarget.extend({ ruleId: z.string() }),
    permissionPolicyConfigurationSchema,
    "mutation",
    "none",
    host,
    "operation.permission.rule.delete",
  ),
  defineOperation(
    "permission.projectTrust.grant",
    z.object({ projectId: z.string() }),
    permissionPolicyConfigurationSchema,
    "mutation",
    "none",
    host,
    "operation.permission.projectTrust.grant",
  ),
  defineOperation(
    "skill.list",
    z.object({ projectId: z.string().optional() }).optional(),
    availableSkillsResponseSchema,
    "read",
    "none",
    host,
    "operation.skill.list",
  ),
  defineOperation(
    "tool.list",
    emptyParams,
    z.object({ tools: z.array(toolDescriptorSchema) }),
    "read",
    "none",
    host,
    "operation.tool.list",
  ),
  defineOperation(
    "completion.slash.list",
    emptyParams,
    z.object({ items: z.array(completionItemSchema) }),
    "read",
    "none",
    host,
    "operation.completion.slash.list",
  ),
] as const;

export const conversationChannelEventSchemas = {
  "agentConfiguration.changed": z.strictObject({ scope: agentScopeSchema }),
  "conversationDefaults.changed": z.strictObject({
    scope: preferenceScopeSchema,
  }),
  "conversation.event": transferredConversationEventSchema,
  "conversation.head": z.object({
    conversationId: z.string(),
    headEventId: z.string().nullable(),
  }),
  "conversation.changed": z.object({
    projectId: z.string(),
    summary: conversationSummarySchema,
  }),
  "conversation.deleted": z.object({
    projectId: z.string(),
    conversationId: z.string(),
  }),
  "conversation.config": z.object({
    conversationId: z.string(),
    config: conversationHistoryConfigSchema,
    appliedAgentProfile: appliedAgentProfileSchema.nullable(),
  }),
  // Includes configuration-blocked waiting interactions and their retry/cancel
  // receipts; no separate event or database state is needed.
  "conversation.toolCall": z.object({
    conversationId: z.string(),
    toolCall: z.union([
      toolCallSchema,
      z.object({ id: z.string(), removed: z.literal(true) }),
    ]),
  }),
  "conversation.queue": z.object({
    conversationId: z.string(),
    queue: z.array(queuedInputSchema),
  }),
  "conversation.asyncBash": z.object({
    conversationId: z.string(),
    asyncBash: z.array(asyncBashSchema),
  }),
  "conversation.compaction": z.object({
    conversationId: z.string(),
    compaction: compactionOperationSchema,
  }),
  "conversation.live": z.object({
    conversationId: z.string(),
    delta: liveDeltaSchema,
  }),
} as const;

export const conversationChannelEvents = [
  defineContentEvent(
    "conversationDefaults.changed",
    conversationChannelEventSchemas["conversationDefaults.changed"],
    { delivery: "ephemeral", scope: [] },
  ),
  defineContentEvent(
    "agentConfiguration.changed",
    conversationChannelEventSchemas["agentConfiguration.changed"],
    { delivery: "ephemeral", scope: [] },
  ),
  defineContentEvent(
    "conversation.event",
    conversationChannelEventSchemas["conversation.event"],
    { delivery: "sequenced", scope: ["conversationId"] },
  ),
  defineContentEvent(
    "conversation.head",
    conversationChannelEventSchemas["conversation.head"],
    {
      delivery: "ephemeral",
      scope: ["conversationId"],
      supersedable: true,
      coalescing: { strategy: "latest_by_scope" },
    },
  ),
  defineContentEvent(
    "conversation.changed",
    conversationChannelEventSchemas["conversation.changed"],
    { delivery: "ephemeral", scope: ["projectId", "summary.id"] },
  ),
  defineContentEvent(
    "conversation.deleted",
    conversationChannelEventSchemas["conversation.deleted"],
    { delivery: "ephemeral", scope: ["projectId", "conversationId"] },
  ),
  defineContentEvent(
    "conversation.config",
    conversationChannelEventSchemas["conversation.config"],
    {
      delivery: "ephemeral",
      scope: ["conversationId"],
      supersedable: true,
      coalescing: { strategy: "latest_by_scope" },
    },
  ),
  defineContentEvent(
    "conversation.toolCall",
    conversationChannelEventSchemas["conversation.toolCall"],
    { delivery: "ephemeral", scope: ["conversationId", "toolCall.id"] },
  ),
  defineContentEvent(
    "conversation.queue",
    conversationChannelEventSchemas["conversation.queue"],
    {
      delivery: "ephemeral",
      scope: ["conversationId"],
      supersedable: true,
      coalescing: { strategy: "latest_by_scope" },
    },
  ),
  defineContentEvent(
    "conversation.asyncBash",
    conversationChannelEventSchemas["conversation.asyncBash"],
    {
      delivery: "ephemeral",
      scope: ["conversationId"],
      supersedable: true,
      coalescing: { strategy: "latest_by_scope" },
    },
  ),
  defineContentEvent(
    "conversation.compaction",
    conversationChannelEventSchemas["conversation.compaction"],
    {
      delivery: "ephemeral",
      scope: ["conversationId"],
      supersedable: true,
      coalescing: { strategy: "latest_by_scope" },
    },
  ),
  defineContentEvent(
    "conversation.live",
    conversationChannelEventSchemas["conversation.live"],
    { delivery: "ephemeral", scope: ["conversationId"] },
  ),
] as const;

export type ConversationChannelOperationName =
  (typeof conversationChannelOperations)[number]["method"];
type ChannelOperation<M extends ConversationChannelOperationName> = Extract<
  (typeof conversationChannelOperations)[number],
  { readonly method: M }
>;
export type ConversationChannelOperationParams<
  M extends ConversationChannelOperationName,
> = z.input<ChannelOperation<M>["paramsSchema"]>;
export type ConversationChannelOperationResult<
  M extends ConversationChannelOperationName,
> = z.infer<ChannelOperation<M>["resultSchema"]>;
export type ConversationChannelEventName =
  keyof typeof conversationChannelEventSchemas;
export type ConversationChannelEventPayload<
  N extends ConversationChannelEventName,
> = z.infer<(typeof conversationChannelEventSchemas)[N]>;
