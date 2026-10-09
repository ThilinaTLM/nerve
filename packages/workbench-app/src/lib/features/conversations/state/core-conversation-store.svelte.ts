import type {
  ConversationConfig,
  ConversationEvent,
  ConversationSnapshot,
  InteractionResolution,
  LiveDelta,
} from "@nervekit/contracts/core";
import { createId } from "@nervekit/contracts";
import {
  installConversationReplaySequence,
  isConversationChannelReady,
  observeConversationChannel,
  requestConversation,
  subscribeConversation,
  unsubscribeConversation,
  type ConversationNotice,
} from "$lib/application/startup/conversation-connection";

export interface LiveAssistantBlock {
  turnId: string;
  contentIndex: number;
  text: string;
  thinking: string;
  toolCall?: { providerCallId: string; name: string; partialArgsText: string };
}

const HISTORY_PAGE_SIZE = 100;

/** One store serves a full pane or a read-only child peek. */
export class ConversationStore {
  snapshot: ConversationSnapshot | undefined = $state();
  events: ConversationEvent[] = $state([]);
  historyEvents: ConversationEvent[] | undefined = $state();
  liveBlocks = $state<LiveAssistantBlock[]>([]);
  toolOutput = $state<Record<string, string>>({});
  activity = $state<string>();
  loading = $state(false);
  loadingOlder = $state(false);
  hasOlder = $state(true);
  connected = $state(false);
  error = $state<string>();
  deleted = $state(false);
  private disposed = false;
  private refreshing: Promise<void> | undefined;
  private historyRefresh: Promise<void> | undefined;
  private historyDirty = false;
  private buffered: (ConversationNotice | ConversationEvent)[] = [];
  private readonly unobserve: () => void;

  constructor(readonly conversationId: string) {
    this.unobserve = observeConversationChannel({
      recover: (id) =>
        id && id !== this.conversationId ? Promise.resolve() : this.recover(),
      disconnected: () => {
        this.connected = false;
        this.clearLive();
      },
      event: (event) => {
        if (event.conversationId !== this.conversationId) return;
        if (this.refreshing) this.buffered.push(event);
        else this.append(event);
      },
      notice: (notice) => {
        const id =
          notice.type === "conversation.changed"
            ? notice.data.summary.id
            : "conversationId" in notice.data
              ? notice.data.conversationId
              : undefined;
        const childChange =
          notice.type === "conversation.changed" &&
          notice.data.summary.parentConversationId === this.conversationId;
        const knownChild =
          (notice.type === "conversation.changed" ||
            notice.type === "conversation.deleted") &&
          this.snapshot?.children.some((child) => child.id === id);
        const recoveringSummaries =
          this.refreshing &&
          (notice.type === "conversation.changed" ||
            notice.type === "conversation.deleted");
        if (
          id !== this.conversationId &&
          !childChange &&
          !knownChild &&
          !recoveringSummaries
        )
          return;
        if (this.refreshing) this.buffered.push(notice);
        else this.applyNotice(notice);
      },
      unavailable: (id) => {
        if (id === this.conversationId) this.markDeleted();
      },
    });
  }

  async open(): Promise<void> {
    await this.recover();
    if (!this.disposed) await subscribeConversation(this.conversationId);
  }

  recover(): Promise<void> {
    if (this.disposed || !isConversationChannelReady())
      return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.loading = true;
    this.error = undefined;
    this.clearLive();
    this.refreshing = this.loadSnapshot()
      .catch((error) => {
        this.error = errorMessage(error);
        throw error;
      })
      .finally(() => {
        this.refreshing = undefined;
        this.loading = false;
        const buffered = this.buffered;
        this.buffered = [];
        if (!this.disposed)
          for (const update of buffered) {
            if ("sequence" in update) this.append(update);
            else this.applyNotice(update);
          }
      });
    return this.refreshing;
  }

  private async loadSnapshot(): Promise<void> {
    const snapshot = await requestConversation("conversation.getSnapshot", {
      conversationId: this.conversationId,
    });
    const events = await requestConversation("conversation.getHistory", {
      conversationId: this.conversationId,
      limit: HISTORY_PAGE_SIZE,
    });
    if (this.disposed) return;
    snapshot.conversation.headEventId = events[0]?.id ?? null;
    this.snapshot = snapshot;
    this.events = chronological(events);
    if (this.historyEvents)
      this.historyEvents = [
        ...Object.values(
          Object.fromEntries(
            [...this.historyEvents, ...events].map((event) => [
              event.id,
              event,
            ]),
          ),
        ),
      ].sort((a, b) => a.sequence - b.sequence);
    this.hasOlder = events.length === HISTORY_PAGE_SIZE;
    await this.loadAllHistory();
    this.connected = true;
    this.deleted = false;
    installConversationReplaySequence(
      this.conversationId,
      snapshot.lastSequence,
    );
  }

  private append(event: ConversationEvent): void {
    if (
      this.historyEvents &&
      !this.historyEvents.some((item) => item.id === event.id)
    )
      this.historyEvents = [...this.historyEvents, event];
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const included = this.events.some((item) => item.id === event.id);
    if (!included) {
      if (event.previousEventId !== snapshot.conversation.headEventId) return;
      this.events = [...this.events, event];
      snapshot.conversation.headEventId = event.id;
    }
    snapshot.lastSequence = Math.max(snapshot.lastSequence, event.sequence);
    if (event.type === "assistant_message")
      this.liveBlocks = this.liveBlocks.filter(
        (block) => block.turnId !== event.turnId,
      );
    if (event.type === "tool_call_response") {
      snapshot.toolCalls = snapshot.toolCalls.filter(
        (call) => call.id !== event.payload.toolCallId,
      );
      delete this.toolOutput[event.payload.toolCallId];
    }
    if (event.inputId)
      snapshot.queue = snapshot.queue.filter(
        (input) => input.inputId !== event.inputId,
      );
    if (
      event.type === "system_event" &&
      event.payload.subtype === "execution_state" &&
      ["completed", "failed", "cancelled", "interrupted"].includes(
        event.payload.transition,
      )
    )
      this.clearLive();
  }

  private applyNotice(notice: ConversationNotice): void {
    const snapshot = this.snapshot;
    switch (notice.type) {
      case "conversation.deleted":
        if (notice.data.conversationId === this.conversationId)
          this.markDeleted();
        else if (snapshot)
          snapshot.children = snapshot.children.filter(
            (child) => child.id !== notice.data.conversationId,
          );
        break;
      case "conversation.changed":
        if (!snapshot) break;
        if (notice.data.summary.id === this.conversationId)
          Object.assign(snapshot.conversation, notice.data.summary);
        else {
          snapshot.children = snapshot.children.filter(
            (child) => child.id !== notice.data.summary.id,
          );
          if (notice.data.summary.parentConversationId === this.conversationId)
            snapshot.children.push(notice.data.summary);
        }
        break;
      case "conversation.head":
        if (
          snapshot &&
          snapshot.conversation.headEventId !== notice.data.headEventId
        ) {
          snapshot.conversation.headEventId = notice.data.headEventId;
          this.clearLive();
          void this.refreshHistory().catch((error) => {
            this.error = errorMessage(error);
          });
        }
        break;
      case "conversation.config":
        if (snapshot) snapshot.config = notice.data.config;
        break;
      case "conversation.queue":
        if (snapshot) snapshot.queue = notice.data.queue;
        break;
      case "conversation.asyncBash":
        if (snapshot) snapshot.asyncBash = notice.data.asyncBash;
        break;
      case "conversation.toolCall": {
        if (!snapshot) break;
        const call = notice.data.toolCall;
        snapshot.toolCalls = snapshot.toolCalls.filter(
          (item) => item.id !== call.id,
        );
        if (!("removed" in call)) snapshot.toolCalls.push(call);
        else delete this.toolOutput[call.id];
        break;
      }
      case "conversation.live":
        this.applyLive(notice.data.delta);
        break;
    }
  }

  private applyLive(delta: LiveDelta): void {
    if (delta.type === "execution_activity") {
      this.activity = delta.activity;
      return;
    }
    if (delta.type === "tool_progress") {
      this.toolOutput[delta.toolCallId] =
        (this.toolOutput[delta.toolCallId] ?? "") + delta.update.chunk;
      return;
    }
    let block = this.liveBlocks.find(
      (item) =>
        item.turnId === delta.turnId &&
        item.contentIndex === delta.contentIndex,
    );
    if (!block) {
      block = {
        turnId: delta.turnId,
        contentIndex: delta.contentIndex,
        text: "",
        thinking: "",
      };
      this.liveBlocks.push(block);
      // Read back the reactive proxy before mutating it.
      block = this.liveBlocks[this.liveBlocks.length - 1];
    }
    if (delta.type === "assistant_text") block.text += delta.delta;
    else if (delta.type === "assistant_thinking") block.thinking += delta.delta;
    else
      block.toolCall = {
        providerCallId: delta.providerCallId,
        name: delta.name,
        partialArgsText: delta.partialArgsText,
      };
  }

  private clearLive(): void {
    this.liveBlocks = [];
    this.toolOutput = {};
    this.activity = undefined;
  }

  refreshHistory(): Promise<void> {
    this.historyDirty = true;
    if (this.historyRefresh) return this.historyRefresh;
    this.historyRefresh = (async () => {
      while (this.historyDirty && !this.disposed) {
        this.historyDirty = false;
        const head = this.snapshot?.conversation.headEventId;
        const events = await requestConversation("conversation.getHistory", {
          conversationId: this.conversationId,
          limit: HISTORY_PAGE_SIZE,
        });
        if (this.disposed) return;
        if (head !== this.snapshot?.conversation.headEventId) {
          this.historyDirty = true;
          continue;
        }
        this.events = chronological(events);
        if (this.historyEvents)
          this.historyEvents = [
            ...Object.values(
              Object.fromEntries(
                [...this.historyEvents, ...events].map((event) => [
                  event.id,
                  event,
                ]),
              ),
            ),
          ].sort((a, b) => a.sequence - b.sequence);
        this.hasOlder = events.length === HISTORY_PAGE_SIZE;
        await this.loadAllHistory();
      }
    })().finally(() => {
      this.historyRefresh = undefined;
    });
    return this.historyRefresh;
  }

  /** Original transcript and usage views consume the complete selected path. */
  async loadAllHistory(): Promise<void> {
    while (!this.disposed && this.hasOlder && !this.loadingOlder) {
      const firstId = this.events[0]?.id;
      await this.loadOlder();
      // An error or a concurrent head change must not spin on the same page.
      if (this.events[0]?.id === firstId) break;
    }
  }

  async loadOlder(): Promise<void> {
    const first = this.events[0];
    if (!first || !this.hasOlder || this.loadingOlder) return;
    this.loadingOlder = true;
    this.error = undefined;
    const head = this.snapshot?.conversation.headEventId;
    try {
      const older = await requestConversation("conversation.getHistory", {
        conversationId: this.conversationId,
        beforeEventId: first.id,
        limit: HISTORY_PAGE_SIZE,
      });
      if (this.disposed || head !== this.snapshot?.conversation.headEventId)
        return;
      const ids = this.events.map((event) => event.id);
      this.events = [
        ...chronological(older).filter((event) => !ids.includes(event.id)),
        ...this.events,
      ];
      this.hasOlder = older.length === HISTORY_PAGE_SIZE;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.loadingOlder = false;
    }
  }

  submit(text: string, inputId = createId("input")): Promise<null> {
    return requestConversation("input.submit", {
      conversationId: this.conversationId,
      inputId,
      text,
      source: "user",
    });
  }
  configure(
    patch: Partial<Omit<ConversationConfig, "conversationId">>,
  ): Promise<null> {
    return requestConversation("conversation.configure", {
      conversationId: this.conversationId,
      patch,
    });
  }
  update(patch: {
    title?: string;
    pinned?: boolean;
    completed?: boolean;
    clearStatus?: boolean;
  }): Promise<null> {
    return requestConversation("conversation.update", {
      conversationId: this.conversationId,
      patch,
    });
  }
  control(
    action: "pause" | "resume" | "stop" | "forcePush" | "continue" | "compact",
  ): Promise<null> {
    return requestConversation(`conversation.${action}`, {
      conversationId: this.conversationId,
    });
  }
  cancelInput(inputId: string): Promise<null> {
    return requestConversation("input.cancel", { inputId });
  }
  async moveInputToComposer(inputId: string): Promise<string> {
    const input = this.snapshot?.queue.find((item) => item.inputId === inputId);
    if (!input || typeof input.content !== "string")
      throw new Error("Queued prompt is unavailable");
    await this.cancelInput(inputId);
    return input.content;
  }
  resolve(
    toolCallId: string,
    resolution: InteractionResolution,
    resolutionRequestId = createId("input"),
  ): Promise<null> {
    return requestConversation("interaction.resolve", {
      toolCallId,
      resolutionRequestId,
      resolution,
    });
  }
  selectHead(eventId: string | null): Promise<null> {
    return requestConversation("conversation.selectHead", {
      conversationId: this.conversationId,
      eventId,
    });
  }
  async loadHistoryTree(): Promise<void> {
    this.historyEvents ??= [...this.events];
    const events = await requestConversation("conversation.getEventsSince", {
      conversationId: this.conversationId,
      sequence: 0,
    });
    if (this.disposed) return;
    const byId = Object.fromEntries(
      [...events, ...this.historyEvents].map((event) => [event.id, event]),
    );
    this.historyEvents = Object.values(byId).sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  tree() {
    return requestConversation("conversation.getTree", {
      conversationId: this.conversationId,
    });
  }
  cancelAsyncBash(bashId: string): Promise<null> {
    return requestConversation("asyncBash.cancel", { bashId });
  }
  delete(): Promise<null> {
    return requestConversation("conversation.delete", {
      conversationId: this.conversationId,
    });
  }

  private markDeleted(): void {
    this.deleted = true;
    this.snapshot = undefined;
    this.events = [];
    this.clearLive();
    void unsubscribeConversation(this.conversationId).catch(() => undefined);
  }
  dispose(): void {
    this.disposed = true;
    this.unobserve();
    void unsubscribeConversation(this.conversationId).catch(() => undefined);
  }
}

function chronological(events: ConversationEvent[]): ConversationEvent[] {
  return [...events].sort((a, b) => a.sequence - b.sequence);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
