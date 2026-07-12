import { z } from "zod";
import type { PeerRole } from "../protocol/envelope.schema.js";
import { eventBatchDataSchema } from "../protocol/event-stream.schema.js";
import { gitEventDefinitions } from "../git/git.events.schema.js";
import { sandboxManagerEventDefinitions } from "../sandbox/sandbox-manager.events.schema.js";
import { sandboxRuntimeEventDefinitions } from "../sandbox/sandbox-runtime.events.schema.js";
import { taskEventDefinitions } from "../tasks/task.events.schema.js";
import { boundedPublicObjectSchema } from "./bounded-public-data.schema.js";
import {
  definePublicEvent,
  type PublicEventDefinition,
} from "./event-definition.schema.js";
import { eventEnvelopeSchema } from "./envelope.schema.js";

export type {
  EventCoalescing,
  PublicEventDefinition,
} from "./event-definition.schema.js";

const definitions: PublicEventDefinition[] = [
  ...sandboxRuntimeEventDefinitions,
  ...taskEventDefinitions,
  ...gitEventDefinitions,
  ...sandboxManagerEventDefinitions,
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
    "approval.updated",
    "userQuestion.updated",
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
  ].map((name) => definePublicEvent(name, boundedPublicObjectSchema)),
  definePublicEvent("storage.cleanup.updated", boundedPublicObjectSchema, {
    durability: "transient",
    coalescing: "latest_by_scope",
    scope: ["operation.id"],
  }),
  definePublicEvent("usage.subscription.updated", boundedPublicObjectSchema, {
    durability: "transient",
    coalescing: "latest_by_scope",
    scope: ["provider"],
  }),
];

const definitionMap = new Map<string, PublicEventDefinition>();
for (const item of definitions) {
  if (definitionMap.has(item.name))
    throw new Error(`Duplicate public event definition: ${item.name}`);
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

export function parsePublicEventEnvelope(
  input: unknown,
  sourceRole: PeerRole,
): import("./envelope.schema.js").EventEnvelope {
  const envelope = requireEventEnvelope(input);
  const item = definitionMap.get(envelope.type);
  if (!item) throw new Error(`Unknown public event: ${envelope.type}`);
  if (!item.allowedSourceRoles.includes(sourceRole)) {
    throw new Error(
      `Event ${envelope.type} cannot be emitted by ${sourceRole}`,
    );
  }
  if (envelope.durability !== item.durability) {
    throw new Error(
      `Event ${envelope.type} must use ${item.durability} durability`,
    );
  }
  return {
    ...envelope,
    data: item.payloadSchema.parse(envelope.data),
  };
}

export function parsePublicEventBatch(
  input: unknown,
  sourceRole: PeerRole,
): import("../protocol/event-stream.schema.js").EventBatchData {
  const batch = requireEventBatch(input);
  return {
    ...batch,
    events: batch.events.map((event) =>
      parsePublicEventEnvelope(event, sourceRole),
    ),
  };
}

function requireEventEnvelope(
  input: unknown,
): import("./envelope.schema.js").EventEnvelope {
  // Kept as a local import boundary so the generic envelope remains
  // transport-neutral while public publication is catalog-authoritative.
  return eventEnvelopeSchema.parse(input);
}

function requireEventBatch(
  input: unknown,
): import("../protocol/event-stream.schema.js").EventBatchData {
  return eventBatchDataSchema.parse(input);
}

export function allPublicEventDefinitions(): PublicEventDefinition[] {
  return [...definitionMap.values()];
}
