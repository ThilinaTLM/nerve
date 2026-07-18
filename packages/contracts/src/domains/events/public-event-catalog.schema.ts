import { z } from "zod";
import { agentEventDefinitions } from "../agents/agent.events.schema.js";
import { authEventDefinitions } from "../auth/auth.events.schema.js";
import { conversationLifecycleEventDefinitions } from "../conversations/conversation.events.schema.js";
import { conversationRuntimeEventDefinitions } from "../conversations/conversation-runtime.events.schema.js";
import { gitEventDefinitions } from "../git/git.events.schema.js";
import { planEventDefinitions } from "../plans/plan.events.schema.js";
import { promptSuggestionEventDefinitions } from "../prompt-suggestions/prompt-suggestion.events.schema.js";
import { projectEventDefinitions } from "../projects/project.events.schema.js";
import type { PeerRole } from "../protocol/envelope.schema.js";
import { eventBatchDataSchema } from "../protocol/event-stream.schema.js";
import { sandboxManagerEventDefinitions } from "../sandbox/sandbox-manager.events.schema.js";
import { sandboxRuntimeEventDefinitions } from "../sandbox/sandbox-runtime.events.schema.js";
import { settingsEventDefinitions } from "../settings/settings.events.schema.js";
import { daemonEventDefinitions } from "../status/daemon.events.schema.js";
import { storageEventDefinitions } from "../storage/storage.events.schema.js";
import { taskEventDefinitions } from "../tasks/task.events.schema.js";
import { toolEventDefinitions } from "../tools/tool.events.schema.js";
import { usageEventDefinitions } from "../usage/usage.events.schema.js";
import { workerEventDefinitions } from "../workers/worker.events.schema.js";
import type { PublicEventDefinition } from "./event-definition.schema.js";
import { eventEnvelopeSchema } from "./envelope.schema.js";

export type {
  EventCoalescing,
  EventDelivery,
  PublicEventDefinition,
} from "./event-definition.schema.js";

const definitions: PublicEventDefinition[] = [
  ...sandboxRuntimeEventDefinitions,
  ...taskEventDefinitions,
  ...gitEventDefinitions,
  ...sandboxManagerEventDefinitions,
  ...conversationLifecycleEventDefinitions,
  ...conversationRuntimeEventDefinitions,
  ...agentEventDefinitions,
  ...toolEventDefinitions,
  ...planEventDefinitions,
  ...projectEventDefinitions,
  ...settingsEventDefinitions,
  ...authEventDefinitions,
  ...workerEventDefinitions,
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
  if (item.delivery !== "sequenced") {
    throw new Error(`Ephemeral event ${envelope.type} cannot use event.batch`);
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
