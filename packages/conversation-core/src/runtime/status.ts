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
  return storage.events
    .since(id, 0)
    .filter(
      (event) =>
        event.type === "system_event" &&
        event.payload.subtype === "execution_state",
    )
    .at(-1);
}
export function openExecutionId(
  storage: CoreStorage,
  id: string,
): string | null {
  const event = latestExecution(storage, id);
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
  ) {}
  refresh(id: string): void {
    const conversation = this.storage.conversations.get(id);
    if (!conversation) return;
    const events = this.storage.events.since(id, 0);
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
    else if (openExecutionId(this.storage, id) || rows.length)
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
    const sequence = events.at(-1)?.sequence ?? 0;
    if (
      status === conversation.status &&
      sequence === conversation.statusEventSequence
    )
      return;
    this.storage.conversations.update(id, {
      status,
      statusEventSequence: sequence,
    });
    this.emit({
      kind: "conversation_changed",
      summary: this.storage.conversations.getSummary(id)!,
    });
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
      this.refresh(id);
    });
    this.emit({ kind: "event_appended", conversationId: id, event });
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
    return event;
  }
}
