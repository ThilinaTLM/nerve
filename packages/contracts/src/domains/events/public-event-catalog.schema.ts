import { z } from "zod";
import { agentEventDefinitions } from "../agents/agent.events.schema.js";
import { runEventDefinitions } from "../agents/run.events.schema.js";
import { authEventDefinitions } from "../auth/auth.events.schema.js";
import { conversationLifecycleEventDefinitions } from "../conversations/conversation.events.schema.js";
import { conversationRuntimeEventDefinitions } from "../conversations/conversation-runtime.events.schema.js";
import { filesystemEventDefinitions } from "../filesystem/filesystem.events.schema.js";
import { gitEventDefinitions } from "../git/git.events.schema.js";
import { planEventDefinitions } from "../plans/plan.events.schema.js";
import { promptSuggestionEventDefinitions } from "../prompt-suggestions/prompt-suggestion.events.schema.js";
import { projectEventDefinitions } from "../projects/project.events.schema.js";
import type { PeerRole } from "../protocol/envelope.schema.js";
import { eventBatchDataSchema } from "../protocol/event-stream.schema.js";
import { settingsEventDefinitions } from "../settings/settings.events.schema.js";
import { daemonEventDefinitions } from "../status/daemon.events.schema.js";
import { storageEventDefinitions } from "../storage/storage.events.schema.js";
import { taskDefinitionEventDefinitions } from "../task-definitions/task-definition.events.schema.js";
import { taskEventDefinitions } from "../tasks/task.events.schema.js";
import { toolEventDefinitions } from "../tools/tool.events.schema.js";
import { usageEventDefinitions } from "../usage/usage.events.schema.js";
import type { PublicEventDefinition } from "./event-definition.schema.js";
import { eventEnvelopeSchema } from "./envelope.schema.js";

export type {
  EventCoalescing,
  EventDelivery,
  PublicEventDefinition,
} from "./event-definition.schema.js";

const definitions: PublicEventDefinition[] = [
  ...taskEventDefinitions,
  ...taskDefinitionEventDefinitions,
  ...filesystemEventDefinitions,
  ...gitEventDefinitions,
  ...conversationLifecycleEventDefinitions,
  ...conversationRuntimeEventDefinitions,
  ...agentEventDefinitions,
  ...runEventDefinitions,
  ...toolEventDefinitions,
  ...planEventDefinitions,
  ...projectEventDefinitions,
  ...settingsEventDefinitions,
  ...authEventDefinitions,
  ...daemonEventDefinitions,
  ...promptSuggestionEventDefinitions,
  ...storageEventDefinitions,
  ...usageEventDefinitions,
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

function parseEventPayload(
  definition: PublicEventDefinition,
  payload: unknown,
): unknown {
  if (!isRecord(payload) || !("conversationRevision" in payload)) {
    return definition.payloadSchema.parse(payload);
  }
  const { conversationRevision, ...domainPayload } = payload;
  if (
    typeof conversationRevision !== "number" ||
    !Number.isSafeInteger(conversationRevision) ||
    conversationRevision < 0
  ) {
    throw new Error("Conversation revision must be a nonnegative safe integer");
  }
  // Revision is transport ordering metadata, not part of each domain payload.
  // Remove it before parsing so strict event schemas remain strict about actual
  // domain fields, then restore it only for conversation-scoped events.
  const parsed = definition.payloadSchema.parse(domainPayload);
  return isRecord(parsed) && typeof parsed.conversationId === "string"
    ? { ...parsed, conversationRevision }
    : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  return parseEventPayload(item, payload);
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
  if (item.delivery !== "sequenced") {
    throw new Error(`Ephemeral event ${envelope.type} cannot use event.batch`);
  }
  return {
    ...envelope,
    data: parseEventPayload(item, envelope.data),
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
