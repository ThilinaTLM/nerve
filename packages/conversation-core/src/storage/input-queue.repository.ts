import type { SQLOutputValue } from "node:sqlite";
import { type QueuedInput, queuedInputSchema } from "@nervekit/contracts/core";
import type { CoreDatabase } from "./database.js";

export type EnqueueInput = Omit<QueuedInput, "acceptanceSequence">;

export class InputQueueRepository {
  constructor(private readonly db: CoreDatabase) {}

  get(inputId: string): QueuedInput | null {
    const row = this.db.sqlite
      .prepare("SELECT * FROM input_queue WHERE input_id = ?")
      .get(inputId);
    return row ? mapQueuedInput(row) : null;
  }

  insert(input: EnqueueInput): QueuedInput {
    return this.db.transaction(() => {
      const conversation = this.db.sqlite
        .prepare(
          "UPDATE conversation SET next_input_sequence = next_input_sequence + 1 WHERE id = ? RETURNING next_input_sequence - 1 AS sequence, parent_conversation_id",
        )
        .get(input.conversationId);
      if (!conversation)
        throw new Error(`Conversation not found: ${input.conversationId}`);
      const row = queuedInputSchema.parse({
        ...input,
        acceptanceSequence: conversation.sequence,
      });
      if (
        row.source === "parent_conversation" &&
        row.senderConversationId !== conversation.parent_conversation_id
      )
        throw new Error(
          "Input sender must be the receiving conversation's parent",
        );
      this.db.sqlite
        .prepare(
          "INSERT INTO input_queue (input_id, conversation_id, acceptance_sequence, source, sender_conversation_id, content, delivery_target, target_execution_id, command_preparation, prepared_text, wake_when_idle, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.inputId,
          row.conversationId,
          row.acceptanceSequence,
          row.source,
          row.senderConversationId,
          JSON.stringify(row.content),
          row.deliveryTarget,
          row.targetExecutionId,
          row.commandPreparation === null
            ? null
            : JSON.stringify(row.commandPreparation),
          row.preparedText,
          Number(row.wakeWhenIdle),
          row.acceptedAt,
        );
      return row;
    });
  }

  update(
    inputId: string,
    patch: Partial<Pick<QueuedInput, "commandPreparation" | "preparedText">>,
  ): QueuedInput {
    const existing = this.get(inputId);
    if (!existing) throw new Error(`QueuedInput not found: ${inputId}`);
    const row = queuedInputSchema.parse({ ...existing, ...patch });
    this.db.sqlite
      .prepare(
        "UPDATE input_queue SET command_preparation = ?, prepared_text = ? WHERE input_id = ?",
      )
      .run(
        row.commandPreparation === null
          ? null
          : JSON.stringify(row.commandPreparation),
        row.preparedText,
        inputId,
      );
    return row;
  }

  list(conversationId: string): QueuedInput[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM input_queue WHERE conversation_id = ? ORDER BY acceptance_sequence",
      )
      .all(conversationId)
      .map(mapQueuedInput);
  }

  listAll(): QueuedInput[] {
    return this.db.sqlite
      .prepare("SELECT * FROM input_queue ORDER BY acceptance_sequence")
      .all()
      .map(mapQueuedInput);
  }

  delete(inputId: string): void {
    this.db.sqlite
      .prepare("DELETE FROM input_queue WHERE input_id = ?")
      .run(inputId);
  }
}

function mapQueuedInput(row: Record<string, SQLOutputValue>): QueuedInput {
  return queuedInputSchema.parse({
    inputId: row.input_id,
    conversationId: row.conversation_id,
    acceptanceSequence: row.acceptance_sequence,
    source: row.source,
    senderConversationId: row.sender_conversation_id,
    content: JSON.parse(String(row.content)),
    deliveryTarget: row.delivery_target,
    targetExecutionId: row.target_execution_id,
    commandPreparation:
      row.command_preparation === null
        ? null
        : JSON.parse(String(row.command_preparation)),
    preparedText: row.prepared_text,
    wakeWhenIdle: row.wake_when_idle === 1,
    acceptedAt: row.accepted_at,
  });
}
