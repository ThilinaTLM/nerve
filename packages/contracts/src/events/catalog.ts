import { conversationChannelEvents } from "../domains/core/channel.js";
import { z } from "zod";
import { scratchNoteEventDefinitions } from "../domains/scratch-notes/events.js";
import { authEventDefinitions } from "../domains/auth/events.js";
import { filesystemEventDefinitions } from "../domains/filesystem/events.js";
import { gitEventDefinitions } from "../domains/git/events.js";
import { planEventDefinitions } from "../domains/plans/events.js";
import type { PeerRole } from "../wire/envelope.js";
import { eventBatchDataSchema } from "../wire/event-stream.js";
import { settingsEventDefinitions } from "../domains/settings/events.js";
import { daemonEventDefinitions } from "../domains/status/events.js";
import { maintenanceEventDefinitions } from "../domains/maintenance/events.js";
import { taskDefinitionEventDefinitions } from "../domains/task-definitions/events.js";
import { launchEventDefinitions } from "../domains/tasks/events.js";
import { usageEventDefinitions } from "../domains/usage/events.js";
import type { PublicEventDefinition } from "./definition.js";
import { eventEnvelopeSchema } from "./envelope.js";
import { isWorkbenchEvent } from "./workbench-events.js";

export type {
  EventCoalescing,
  EventDelivery,
  PublicEventDefinition,
} from "./definition.js";

const definitions: PublicEventDefinition[] = [
  ...conversationChannelEvents,
  ...launchEventDefinitions,
  ...scratchNoteEventDefinitions,
  ...taskDefinitionEventDefinitions,
  ...filesystemEventDefinitions,
  ...gitEventDefinitions,
  ...planEventDefinitions,
  ...settingsEventDefinitions,
  ...authEventDefinitions,
  ...daemonEventDefinitions,
  ...maintenanceEventDefinitions,
  ...usageEventDefinitions,
];

const definitionMap = new Map<string, PublicEventDefinition>();
for (const item of definitions) {
  if (definitionMap.has(item.name))
    throw new Error(`Duplicate public event definition: ${item.name}`);
  definitionMap.set(
    item.name,
    isWorkbenchEvent(item.name) ? { ...item, delivery: "ephemeral" } : item,
  );
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
  return definition.payloadSchema.parse(payload);
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
): import("./envelope.js").EventEnvelope {
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
): import("../wire/event-stream.js").EventBatchData {
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
): import("./envelope.js").EventEnvelope {
  // Kept as a local import boundary so the generic envelope remains
  // transport-neutral while public publication is catalog-authoritative.
  return eventEnvelopeSchema.parse(input);
}

function requireEventBatch(
  input: unknown,
): import("../wire/event-stream.js").EventBatchData {
  return eventBatchDataSchema.parse(input);
}

export function allPublicEventDefinitions(): PublicEventDefinition[] {
  return [...definitionMap.values()];
}
