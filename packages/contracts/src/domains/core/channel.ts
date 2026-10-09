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
import { permissionRuleSetSchema } from "../permissions/permission-rule-sets.js";
import { availableSkillsResponseSchema } from "../skills/skill.js";
import { toolDescriptorSchema } from "../tools/records.js";
import { completionItemSchema } from "../completions/completion.js";
import { coreOperationSchemas } from "./core-operations.js";
import { conversationEventSchema } from "./event.js";
import {
  conversationConfigSchema,
  conversationSummarySchema,
} from "./conversation.js";
import { toolCallSchema } from "./tool-call.js";
import { queuedInputSchema } from "./input.js";
import { asyncBashSchema } from "./async-bash.js";
import { liveDeltaSchema } from "./live.js";

import {
  capabilityConfigurationSchema,
  capabilityOverridesDocumentSchema,
  capabilityPatchSchema,
  capabilityOriginSchema,
} from "../capabilities/capabilities.js";

const emptyParams = z.object({}).optional();
const host = ["workbench_server"] as const;

const capabilityScope = z.object({
  projectId: z.string(),
  conversationId: z.string().optional(),
});
export const conversationChannelOperations = [
  defineOperation(
    "capabilities.get",
    capabilityScope,
    capabilityConfigurationSchema,
    "read",
    "none",
    host,
    "operation.capabilities.get",
  ),
  defineOperation(
    "capabilities.update",
    capabilityScope.extend({
      layer: capabilityOriginSchema,
      patch: capabilityPatchSchema.optional(),
      replace: capabilityOverridesDocumentSchema.optional(),
      expectedDigest: z.string().optional(),
    }),
    capabilityConfigurationSchema,
    "mutation",
    "none",
    host,
    "operation.capabilities.update",
  ),
  defineOperation(
    "capabilities.reset",
    capabilityScope.extend({ layer: capabilityOriginSchema }),
    capabilityConfigurationSchema,
    "mutation",
    "none",
    host,
    "operation.capabilities.reset",
  ),
  defineOperation(
    "capabilities.trust",
    z.object({ projectId: z.string(), digest: z.string() }),
    capabilityConfigurationSchema,
    "mutation",
    "none",
    host,
    "operation.capabilities.trust",
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
  "capabilities.changed": capabilityScope,
  "conversation.event": conversationEventSchema,
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
    config: conversationConfigSchema,
  }),
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
  "conversation.live": z.object({
    conversationId: z.string(),
    delta: liveDeltaSchema,
  }),
} as const;

export const conversationChannelEvents = [
  defineContentEvent(
    "capabilities.changed",
    conversationChannelEventSchemas["capabilities.changed"],
    { delivery: "ephemeral", scope: ["projectId"] },
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
