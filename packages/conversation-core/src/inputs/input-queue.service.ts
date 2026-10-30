import { publishSummary } from "../runtime/publish-summary.js";
import { isDeepStrictEqual } from "node:util";
import { createId } from "@nervekit/contracts";
import {
  submitInputRequestSchema,
  systemNoticeSchema,
  type ConversationEvent,
  type DeliveryTarget,
  type QueuedInput,
  type SubmitInputRequest,
  type SystemNotice,
} from "@nervekit/contracts/core";
import type { ProcessPort } from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { EnqueueInput } from "../storage/input-queue.repository.js";
import {
  initialCommandPreparation,
  prepareCommands,
} from "./command-preparation.js";

export type InputBoundary =
  | { kind: "turn"; executionId?: string }
  | { kind: "execution_start"; executionId: string };
export type InputQueueChange =
  | {
      kind: "conversation_changed";
      summary: import("@nervekit/contracts/core").ConversationSummary;
    }
  | { kind: "event_appended"; conversationId: string; event: ConversationEvent }
  | { kind: "queue_changed"; conversationId: string; queue: QueuedInput[] };
export type EnqueueNoticeRequest = {
  conversationId: string;
  inputId: string;
  deliveryTarget?: DeliveryTarget;
  targetExecutionId?: string | null;
  wakeWhenIdle: boolean;
} & (SystemNotice extends infer N
  ? N extends SystemNotice
    ? Pick<N, "subtype" | "producer" | "text"> & {
        details?: Omit<N, "subtype" | "producer" | "text">;
      }
    : never
  : never);

export class InputQueueService {
  private readonly preparations = new Map<string, AbortController>();

  constructor(
    private readonly options: {
      storage: CoreStorage;
      processes: ProcessPort;
      emit(change: InputQueueChange): void;
      requestWake(conversationId: string): void;
    },
  ) {}

  /** Sub-agents take work from their parent only; the composer is disabled for them. */
  assertAcceptsSource(conversationId: string, source: string): void {
    if (
      source === "user" &&
      this.options.storage.conversations.get(conversationId)
        ?.parentConversationId
    )
      throw new Error("Sub-agents do not accept user input");
  }

  submit(request: SubmitInputRequest): QueuedInput | "delivered" {
    const accepted = this.acceptSubmission(request);
    accepted.afterCommit();
    return accepted.result;
  }

  /** Transaction-safe acceptance. The caller must run afterCommit only after commit. */
  acceptSubmission(request: SubmitInputRequest): {
    result: QueuedInput | "delivered";
    afterCommit(): void;
  } {
    const input = submitInputRequestSchema.parse(request);
    this.assertAcceptsSource(input.conversationId, input.source);
    const preparation = initialCommandPreparation(input.text);
    const result = this.accept({
      inputId: input.inputId,
      conversationId: input.conversationId,
      source: input.source,
      senderConversationId: input.senderConversationId ?? null,
      content: input.text,
      deliveryTarget: input.deliveryTarget ?? "next_turn",
      targetExecutionId: input.targetExecutionId ?? null,
      commandPreparation: preparation,
      preparedText: preparation ? null : input.text,
      wakeWhenIdle: input.wakeWhenIdle ?? true,
      acceptedAt: new Date().toISOString(),
    });
    if (result === "delivered") return { result, afterCommit() {} };
    const unpause =
      input.source === "user" &&
      this.options.storage.conversations.get(input.conversationId)?.paused;
    if (unpause) {
      this.options.storage.conversations.update(input.conversationId, {
        paused: false,
      });
    }
    return {
      result,
      afterCommit: () => {
        this.changed(input.conversationId);
        this.startPreparation(result);
        this.wake(result);
      },
    };
  }

  enqueueNotice(request: EnqueueNoticeRequest): QueuedInput | "delivered" {
    const notice = systemNoticeSchema.parse({
      ...request.details,
      subtype: request.subtype,
      producer: request.producer,
      text: request.text,
    });
    const result = this.accept({
      inputId: request.inputId,
      conversationId: request.conversationId,
      source: "system",
      senderConversationId: null,
      content: notice,
      deliveryTarget: request.deliveryTarget ?? "next_turn",
      targetExecutionId: request.targetExecutionId ?? null,
      commandPreparation: null,
      preparedText: null,
      wakeWhenIdle: request.wakeWhenIdle,
      acceptedAt: new Date().toISOString(),
    });
    if (result !== "delivered") {
      this.changed(request.conversationId);
      this.wake(result);
    }
    return result;
  }

  cancel(inputId: string): void {
    const row = this.options.storage.inputs.get(inputId);
    this.preparations.get(inputId)?.abort();
    this.preparations.delete(inputId);
    if (!row) return;
    this.options.storage.inputs.delete(inputId);
    this.changed(row.conversationId);
  }

  close(): void {
    // Fence late saves without removing prompts or rewriting uncertain outcomes.
    for (const controller of this.preparations.values()) controller.abort();
    this.preparations.clear();
  }

  list(conversationId: string): QueuedInput[] {
    return this.options.storage.inputs.list(conversationId);
  }

  deliver(
    conversationId: string,
    boundary: InputBoundary,
    limit?: { beforeSequence?: number },
  ): ConversationEvent[] {
    const storage = this.options.storage;
    const events = storage.transaction(() => {
      if (storage.toolCalls.list(conversationId).length) return [];
      const delivered: ConversationEvent[] = [];
      for (const row of this.eligible(conversationId, boundary, limit)) {
        const common = {
          id: createId("evt"),
          conversationId,
          turnId: null,
          inputId: row.inputId,
          createdAt: new Date().toISOString(),
        };
        const event =
          row.source !== "system" && typeof row.content === "string"
            ? storage.events.append({
                ...common,
                type: "user_message",
                llmRepresentation: "user",
                payload: {
                  text: row.preparedText ?? row.content,
                  originalText: row.content,
                  acceptedAt: row.acceptedAt,
                  source: row.source,
                  senderConversationId: row.senderConversationId,
                  commandPreparation: row.commandPreparation,
                },
              })
            : storage.events.append({
                ...common,
                type: "system_event",
                llmRepresentation: "user",
                payload: systemNoticeSchema.parse(row.content),
              });
        if (event.type === "system_event" && "assetIds" in event.payload) {
          for (const id of event.payload.assetIds) {
            const asset = storage.assets.get(id);
            if (
              asset &&
              asset.eventId === null &&
              asset.conversationId === conversationId
            )
              storage.assets.update(id, { eventId: event.id });
          }
        }
        storage.inputs.delete(row.inputId);
        delivered.push(event);
      }
      return delivered;
    });
    for (const event of events)
      this.options.emit({ kind: "event_appended", conversationId, event });
    if (events.length) this.changed(conversationId);
    return events;
  }

  hasDeliverable(conversationId: string, boundary: InputBoundary): boolean {
    return (
      !this.options.storage.toolCalls.list(conversationId).length &&
      this.eligible(conversationId, boundary).length > 0
    );
  }

  recover(conversationId?: string): void {
    const rows =
      conversationId === undefined
        ? this.options.storage.inputs.listAll()
        : this.options.storage.inputs.list(conversationId);
    for (const row of rows) {
      if (row.commandPreparation && row.preparedText === null) {
        for (const block of row.commandPreparation.blocks)
          if (block.state === "running") block.state = "indeterminate";
        this.options.storage.inputs.update(row.inputId, {
          commandPreparation: row.commandPreparation,
        });
        this.startPreparation(row);
      }
    }
  }

  private accept(input: EnqueueInput): QueuedInput | "delivered" {
    const storage = this.options.storage;
    const result = storage.transaction(() => {
      const queued = storage.inputs.get(input.inputId);
      if (queued) {
        if (
          ![
            "conversationId",
            "source",
            "senderConversationId",
            "content",
            "deliveryTarget",
            "targetExecutionId",
            "wakeWhenIdle",
          ].every((key) =>
            isDeepStrictEqual(
              queued[key as keyof QueuedInput],
              input[key as keyof EnqueueInput],
            ),
          )
        )
          throw new Error("Input ID reused with different content");
        return queued;
      }
      const event = storage.events.findByInputId(input.inputId);
      if (event) {
        const matches =
          event.conversationId === input.conversationId &&
          (event.type === "user_message"
            ? event.payload.originalText === input.content &&
              event.payload.source === input.source &&
              event.payload.senderConversationId === input.senderConversationId
            : event.type === "system_event" &&
              input.source === "system" &&
              isDeepStrictEqual(event.payload, input.content));
        if (!matches) throw new Error("Input ID reused with different content");
        return "delivered" as const;
      }
      return storage.inputs.insert(input);
    });
    return result;
  }

  private eligible(
    conversationId: string,
    boundary: InputBoundary,
    limit?: { beforeSequence?: number },
  ): QueuedInput[] {
    const queued = this.list(conversationId);
    if (!queued.length) return [];
    const history = this.options.storage.events.since(conversationId, 0);
    let executionId: string | undefined;
    const finished = new Set<string>();
    for (const event of history) {
      if (
        event.type !== "system_event" ||
        event.payload.subtype !== "execution_state"
      )
        continue;
      if (event.payload.transition === "started") executionId = event.id;
      else if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          event.payload.transition,
        )
      ) {
        finished.add(event.payload.executionId);
        if (executionId === event.payload.executionId) executionId = undefined;
      }
    }
    executionId = boundary.executionId ?? executionId;
    const rows: QueuedInput[] = [];
    for (const row of queued) {
      if (
        limit?.beforeSequence !== undefined &&
        row.acceptanceSequence >= limit.beforeSequence
      )
        continue;
      const eligible =
        row.deliveryTarget === "next_turn" ||
        (row.deliveryTarget === "specific_execution" &&
          row.targetExecutionId === executionId) ||
        (row.deliveryTarget === "next_execution" &&
          boundary.kind === "execution_start" &&
          (!row.targetExecutionId || finished.has(row.targetExecutionId)));
      if (!eligible) continue;
      if (row.commandPreparation && row.preparedText === null) break;
      rows.push(row);
    }
    return rows;
  }

  private startPreparation(row: QueuedInput): void {
    if (
      !row.commandPreparation ||
      row.preparedText !== null ||
      typeof row.content !== "string" ||
      this.preparations.has(row.inputId)
    )
      return;
    const config = this.options.storage.conversations.getContext(
      row.conversationId,
    );
    if (!config)
      throw new Error(
        `Conversation configuration not found: ${row.conversationId}`,
      );
    const controller = new AbortController();
    this.preparations.set(row.inputId, controller);
    // Defer execution until after submission has returned.
    void Promise.resolve()
      .then(() =>
        prepareCommands({
          conversationId: row.conversationId,
          text: row.content as string,
          preparation: row.commandPreparation!,
          cwd: config.workingDirectory,
          signal: controller.signal,
          processes: this.options.processes,
          save: (commandPreparation, preparedText) => {
            if (
              controller.signal.aborted ||
              this.preparations.get(row.inputId) !== controller ||
              !this.options.storage.inputs.get(row.inputId)
            )
              return false;
            this.options.storage.inputs.update(row.inputId, {
              commandPreparation,
              ...(preparedText !== undefined ? { preparedText } : {}),
            });
            this.changed(row.conversationId);
            return true;
          },
        }),
      )
      .finally(() => {
        if (this.preparations.get(row.inputId) !== controller) return;
        this.preparations.delete(row.inputId);
        if (!controller.signal.aborted) this.wake(row);
      });
  }

  private wake(row: QueuedInput): void {
    if (
      row.wakeWhenIdle &&
      !this.options.storage.conversations.get(row.conversationId)?.paused
    )
      this.options.requestWake(row.conversationId);
  }

  private changed(conversationId: string): void {
    this.options.emit({
      kind: "queue_changed",
      conversationId,
      queue: this.list(conversationId),
    });
    publishSummary(this.options.storage, this.options.emit, conversationId);
  }
}
