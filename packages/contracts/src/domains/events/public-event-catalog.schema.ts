import { z } from "zod";
import { conversationEventPayloadSchemas } from "../conversations/index.js";
import { sandboxEventPayloadSchemas } from "../sandbox/sandbox.events.schema.js";
import {
  managedContainerRefSchema,
  managedSandboxLifecycleStateSchema,
  managedSandboxObservedStateSchema,
  sandboxActivitySummarySchema,
} from "../sandbox/sandbox.manager.schema.js";
import { taskRecordSchema } from "../tasks/index.js";
import type { PeerRole } from "../protocol/envelope.schema.js";

export type EventCoalescing = "latest_by_scope" | "concat_delta";

export interface PublicEventDefinition {
  readonly name: string;
  readonly payloadSchema: z.ZodType;
  readonly durability: "durable" | "transient";
  readonly allowedSourceRoles: readonly PeerRole[];
  readonly coalescing?: EventCoalescing;
  readonly scope: readonly string[];
}

const hostRoles = ["workbench_server", "sandbox_agent"] as const;
const managerRoles = ["sandbox_manager"] as const;
const genericPayloadSchema = z.record(z.string(), z.unknown());
const taskPayloadSchema = z.object({ task: taskRecordSchema }).passthrough();

function definition(
  name: string,
  payloadSchema: z.ZodType,
  options: Partial<Omit<PublicEventDefinition, "name" | "payloadSchema">> = {},
): PublicEventDefinition {
  return {
    name,
    payloadSchema,
    durability: options.durability ?? "durable",
    allowedSourceRoles: options.allowedSourceRoles ?? hostRoles,
    coalescing: options.coalescing,
    scope: options.scope ?? [],
  };
}

const definitions: PublicEventDefinition[] = [
  ...Object.entries(conversationEventPayloadSchemas).map(
    ([name, payloadSchema]) =>
      definition(name, payloadSchema, {
        durability: name.startsWith("conversation.live.")
          ? "transient"
          : "durable",
        coalescing: name.endsWith(".delta") ? "concat_delta" : undefined,
        scope: ["conversationId", "runId"],
      }),
  ),
  ...Object.entries(sandboxEventPayloadSchemas).map(([name, payloadSchema]) =>
    definition(name, payloadSchema, {
      durability: name === "run.delta" ? "transient" : "durable",
      scope: ["sandboxId", "conversationId", "runId"],
    }),
  ),
  ...[
    "task.created",
    "task.started",
    "task.ready",
    "task.stop_requested",
    "task.completed",
    "task.failed",
    "task.timed_out",
    "task.cancelled",
    "task.orphaned",
    "task.removed",
  ].map((name) => definition(name, taskPayloadSchema, { scope: ["task.id"] })),
  definition(
    "task.output",
    z.object({
      taskId: z.string().startsWith("task_"),
      stream: z.enum(["stdout", "stderr", "combined"]),
      text: z.string().max(16_384),
    }),
    {
      durability: "transient",
      coalescing: "concat_delta",
      scope: ["taskId", "stream"],
    },
  ),
  definition(
    "git.repository.changed",
    z.object({
      projectId: z.string().startsWith("proj_").optional(),
      repo: z.string().min(1).max(1_024),
      reason: z.string().min(1).max(128),
      head: z
        .object({
          branch: z.string().max(256).optional(),
          oid: z.string().max(128).optional(),
        })
        .optional(),
    }),
    { scope: ["projectId", "repo"] },
  ),
  definition(
    "sandbox.lifecycle.changed",
    z.object({
      sandboxId: z.string().min(1),
      previous: managedSandboxLifecycleStateSchema.optional(),
      current: managedSandboxLifecycleStateSchema,
      changedAt: z.string().datetime(),
      reason: z.string().max(1_024).optional(),
    }),
    { allowedSourceRoles: managerRoles, scope: ["sandboxId"] },
  ),
  definition(
    "container.lifecycle.changed",
    z.object({
      sandboxId: z.string().min(1),
      container: managedContainerRefSchema.optional(),
      previous: managedSandboxObservedStateSchema.optional(),
      current: managedSandboxObservedStateSchema,
      changedAt: z.string().datetime(),
      reason: z.string().max(1_024).optional(),
    }),
    { allowedSourceRoles: managerRoles, scope: ["sandboxId"] },
  ),
  definition(
    "sandbox.daemon.connection_changed",
    z.object({
      sandboxId: z.string().min(1),
      previous: z.enum(["connected", "disconnected"]).optional(),
      current: z.enum(["connected", "disconnected"]),
      changedAt: z.string().datetime(),
      reason: z.string().max(1_024).optional(),
    }),
    { allowedSourceRoles: managerRoles, scope: ["sandboxId"] },
  ),
  definition("sandbox.activity.changed", sandboxActivitySummarySchema, {
    allowedSourceRoles: managerRoles,
    coalescing: "latest_by_scope",
    scope: ["sandboxId"],
  }),
  ...[
    "conversation.created",
    "conversation.updated",
    "conversation.deleted",
    "conversation.navigated",
    "conversation.branch_summarized",
    "conversation.imported",
    "agent.created",
    "agent.configured",
    "agent.status_changed",
    "agent.mode_changed",
    "agent.abort_requested",
    "agent.suspension.created",
    "agent.suspension.updated",
    "agent.explore_completed",
    "agent.subagent_started",
    "agent.subagent_completed",
    "approval.requested",
    "approval.granted",
    "approval.denied",
    "userQuestion.requested",
    "userQuestion.answered",
    "userQuestion.dismissed",
    "planReview.requested",
    "planReview.accepted",
    "planReview.accepted_in_new_chat",
    "planReview.changes_requested",
    "planReview.rejected",
    "planReview.discarded",
    "planReview.force_exited",
    "project.created",
    "project.deleted",
    "project.conversations.pruned",
    "settings.updated",
    "providers.catalog_changed",
    "auth.providers_changed",
    "auth.oauth_login_succeeded",
    "auth.oauth_login_failed",
    "auth.oauth_flow_updated",
    "auth.credential_deleted",
    "worker.created",
    "worker.agent_started",
    "policy.evaluated",
    "daemon.started",
    "prompt_suggestions.trust_updated",
    "secrets.provider_key_set",
    "secrets.provider_key_deleted",
    "task.promoted",
    "task.runtime_updated",
    "task.orphan_cleanup_succeeded",
    "task.cleanup_failed",
  ].map((name) => definition(name, genericPayloadSchema)),
  definition("storage.cleanup.updated", genericPayloadSchema, {
    durability: "transient",
    coalescing: "latest_by_scope",
    scope: ["operation.id"],
  }),
  definition("usage.subscription.updated", genericPayloadSchema, {
    durability: "transient",
    coalescing: "latest_by_scope",
    scope: ["provider"],
  }),
];

const definitionMap = new Map<string, PublicEventDefinition>();
for (const item of definitions) {
  if (definitionMap.has(item.name)) continue;
  definitionMap.set(item.name, item);
}

export const publicEventNameSchema = z.enum([...definitionMap.keys()] as [
  string,
  ...string[],
]);
export type PublicEventName = z.infer<typeof publicEventNameSchema>;

export function publicEventDefinition(
  name: string,
): PublicEventDefinition | undefined {
  return definitionMap.get(name);
}

export function validatePublicEvent(
  name: string,
  payload: unknown,
  sourceRole: PeerRole,
): unknown {
  const item = definitionMap.get(name);
  if (!item) throw new Error(`Unknown public event: ${name}`);
  if (!item.allowedSourceRoles.includes(sourceRole)) {
    throw new Error(`Event ${name} cannot be emitted by ${sourceRole}`);
  }
  return item.payloadSchema.parse(payload);
}

export function allPublicEventDefinitions(): PublicEventDefinition[] {
  return [...definitionMap.values()];
}
