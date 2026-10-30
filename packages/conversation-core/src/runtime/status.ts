import { publishSummary } from "./publish-summary.js";
import { createId } from "@nervekit/contracts";
import {
  type ConversationEvent,
  type ConversationStatus,
  type ExecutionStatePayload,
} from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";
import type { CoreEmitter } from "./core-change.js";
import type { ExecutionFinished } from "./conversation-runner.js";

export function latestExecution(
  storage: CoreStorage,
  id: string,
): ConversationEvent | undefined {
  return storage.events.latestExecution(id);
}
export function openExecutionId(
  storage: CoreStorage,
  id: string,
): string | null {
  return executionIdFromEvent(latestExecution(storage, id));
}

function executionIdFromEvent(
  event: ConversationEvent | undefined,
): string | null {
  if (
    !event ||
    event.type !== "system_event" ||
    event.payload.subtype !== "execution_state"
  )
    return null;
  const payload = event.payload;
  return payload.transition === "started"
    ? event.id
    : ["waiting", "retrying"].includes(payload.transition)
      ? "executionId" in payload
        ? payload.executionId
        : null
      : null;
}

export class StatusService {
  constructor(
    private readonly storage: CoreStorage,
    private readonly emit: CoreEmitter,
    private readonly now: () => string,
    private readonly finished: (result: ExecutionFinished) => void,
    private readonly processing: (id: string) => boolean,
  ) {}
  refresh(id: string, publish = true): void {
    const conversation = this.storage.conversations.get(id);
    if (!conversation) return;
    const last = latestExecution(this.storage, id);
    let status: ConversationStatus = "idle";
    const rows = this.storage.toolCalls.list(id);
    if (
      rows.some(
        (row) =>
          row.state === "awaiting_approval" || row.state === "awaiting_input",
      )
    )
      status = "waiting";
    else if (executionIdFromEvent(last) || rows.length || this.processing(id))
      status = "running";
    else if (
      last?.type === "system_event" &&
      last.payload.subtype === "execution_state" &&
      (last.payload.transition === "failed" ||
        last.payload.transition === "interrupted") &&
      (!conversation.statusClearedAt ||
        last.createdAt > conversation.statusClearedAt)
    )
      status = last.payload.transition;
    const sequence = this.storage.events.lastSequence(id);
    if (
      status === conversation.status &&
      sequence === conversation.statusEventSequence
    )
      return;
    this.storage.conversations.update(id, {
      status,
      statusEventSequence: sequence,
    });
    if (publish) publishSummary(this.storage, this.emit, id);
  }
  transition(id: string, payload: ExecutionStatePayload): ConversationEvent {
    let event!: ConversationEvent;
    this.storage.transaction(() => {
      event = this.storage.events.append({
        id: createId("evt"),
        conversationId: id,
        type: "system_event",
        llmRepresentation: "none",
        turnId: null,
        inputId: null,
        payload,
        createdAt: this.now(),
      });
      // Terminal reports may enqueue a wake input for the parent. Update status
      // silently first, then publish only once the report is queued, atomically.
      this.refresh(id, false);
      if (
        payload.transition === "completed" ||
        payload.transition === "failed" ||
        payload.transition === "cancelled" ||
        payload.transition === "interrupted"
      )
        this.finished({
          conversationId: id,
          executionId: payload.executionId,
          transition: payload.transition,
          event,
        });
    });
    publishSummary(this.storage, this.emit, id);
    this.emit({ kind: "event_appended", conversationId: id, event });
    return event;
  }
}
