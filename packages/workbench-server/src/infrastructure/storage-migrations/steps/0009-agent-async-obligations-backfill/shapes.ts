import type { JsonValueV1 } from "../../kit/json/v1.js";
import {
  booleanV1,
  looseObjectV1,
  nonnegativeIntegerV1,
  optionalStringV1,
  stringV1,
} from "../../kit/shapes/v1.js";

function timestampV1(value: unknown, label: string): string {
  const timestamp = stringV1(value, label);
  if (!Number.isFinite(Date.parse(timestamp)))
    throw new Error(`${label} must be a valid timestamp.`);
  return timestamp;
}

function optionalTimestampV1(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : timestampV1(value, label);
}

export interface LegacySubagentCompletionV1 {
  runId: string;
  childId: string;
  leadId: string;
  conversationId: string;
  entryId: string;
  generation: number;
  createdAt: string;
  deliveredAt?: string;
  consumedAt?: string;
  suppressed: boolean;
  outcome?: JsonValueV1;
}

export function legacySubagentCompletionV1(
  value: unknown,
): LegacySubagentCompletionV1 {
  const object = looseObjectV1(value, "legacy subagent completion");
  return {
    runId: stringV1(object.runId, "runId"),
    childId: stringV1(object.childId, "childId"),
    leadId: stringV1(object.leadId, "leadId"),
    conversationId: stringV1(object.conversationId, "conversationId"),
    entryId: stringV1(object.entryId, "entryId"),
    generation: nonnegativeIntegerV1(object.generation, "generation"),
    createdAt: timestampV1(object.createdAt, "createdAt"),
    deliveredAt: optionalTimestampV1(object.deliveredAt, "deliveredAt"),
    consumedAt: optionalTimestampV1(object.consumedAt, "consumedAt"),
    suppressed: booleanV1(object.suppressed, "suppressed"),
    outcome: object.outcome as JsonValueV1 | undefined,
  };
}

export interface LegacyTaskCompletionV1 {
  inject?: unknown;
  injectedAt?: string;
  entryId?: string;
}

export interface LegacyTaskNotificationsV1 {
  terminalDeliveredAt?: string;
  terminalEntryId?: string;
}

export interface LegacyTaskV1 {
  id: string;
  status: string;
  conversationId?: string;
  agentId?: string;
  startedAt: string;
  updatedAt?: string;
  restartGeneration: number;
  completion?: LegacyTaskCompletionV1;
  notifications?: LegacyTaskNotificationsV1;
}

/** Frozen minimal task shape; unrelated and future fields are intentionally ignored. */
export function legacyTaskV1(value: unknown): LegacyTaskV1 {
  const object = looseObjectV1(value, "legacy task");
  const completion =
    object.completion === undefined
      ? undefined
      : looseObjectV1(object.completion, "task.completion");
  const notifications =
    object.notifications === undefined
      ? undefined
      : looseObjectV1(object.notifications, "task.notifications");
  return {
    id: stringV1(object.id, "task.id"),
    status: stringV1(object.status, "task.status"),
    conversationId: optionalStringV1(
      object.conversationId,
      "task.conversationId",
    ),
    agentId: optionalStringV1(object.agentId, "task.agentId"),
    startedAt: timestampV1(object.startedAt, "task.startedAt"),
    updatedAt: optionalTimestampV1(object.updatedAt, "task.updatedAt"),
    restartGeneration:
      object.restartGeneration === undefined
        ? 0
        : nonnegativeIntegerV1(
            object.restartGeneration,
            "task.restartGeneration",
          ),
    completion: completion
      ? {
          inject: completion.inject,
          injectedAt: optionalTimestampV1(
            completion.injectedAt,
            "task.completion.injectedAt",
          ),
          entryId: optionalStringV1(
            completion.entryId,
            "task.completion.entryId",
          ),
        }
      : undefined,
    notifications: notifications
      ? {
          terminalDeliveredAt: optionalTimestampV1(
            notifications.terminalDeliveredAt,
            "task.notifications.terminalDeliveredAt",
          ),
          terminalEntryId: optionalStringV1(
            notifications.terminalEntryId,
            "task.notifications.terminalEntryId",
          ),
        }
      : undefined,
  };
}
