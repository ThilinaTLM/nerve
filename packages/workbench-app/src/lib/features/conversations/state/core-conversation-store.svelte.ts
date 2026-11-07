import type {
  EffectiveAgentView,
  GetAgentConfigurationResult,
  InteractionResolveResult,
} from "@nervekit/contracts/agent-configuration";
import { switchAgentProfile } from "../adapters/core-agent-configuration.adapter";
import type {
  ConversationConfig,
  TransferredConversationEvent,
  ConversationSnapshot,
  InteractionResolution,
  LiveDelta,
} from "@nervekit/contracts/core";
import { createId } from "@nervekit/contracts";
import { suppressNextCompletion } from "$lib/application/activity/user-stop";
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

import { patchChanged } from "$lib/domain/conversations/summary-patch";
import { resetLiveTurnBlocks } from "./live-blocks";
import {
  LiveDeltaBuffer,
  applyLiveBatch,
  type LiveBatch,
} from "./live-delta-buffer";
import { LiveTurnGuard } from "./live-turn-guard";
import { reconcileCompactionNotice } from "./compaction-reconciliation";
import {
  fetchCompleteHistory,
  type FetchedHistory,
} from "./conversation-history";

// The server byte-limits each history page, so the byte cap is the real bound;
// the limit only needs to be above that without making the server map
// thousands of rows it will discard.
const HISTORY_PAGE_SIZE = 1000;

/** One store serves a full pane or a read-only child peek. */
export class ConversationStore {
  effective = $state<EffectiveAgentView>();
  configuration = $state<GetAgentConfigurationResult>();
  snapshot: ConversationSnapshot | undefined = $state();
  events: TransferredConversationEvent[] = $state([]);
  historyEvents: TransferredConversationEvent[] | undefined = $state();
  /** Replaced (never mutated) at most once per frame by the delta buffer. */
  liveBlocks = $state.raw<LiveAssistantBlock[]>([]);
  toolOutput = $state.raw<Record<string, string>>({});
  activity = $state<string>();
  /** Bumps on each provider-request restart so views can reset wait timing. */
  responseRevision = $state(0);
  /** A Stop request is in flight from any surface (button, shortcut). */
  stopping = $state(false);
  loading = $state(false);
  hasOlder = $state(true);
  connected = $state(false);
  error = $state<string>();
  deleted = $state(false);
  private disposed = false;
  private configurationGeneration = 0;
  private readonly liveTurns = new LiveTurnGuard();
  /** Plain accumulation of text/thinking/tool-arg/progress deltas. */
  private readonly liveDeltas = new LiveDeltaBuffer((batch) =>
    this.commitLive(batch),
  );
  private refreshing: Promise<void> | undefined;
  private historyRefresh: Promise<void> | undefined;
  private historyDirty = false;
  private buffered: (ConversationNotice | TransferredConversationEvent)[] = [];
  private readonly unobserve: () => void;

  constructor(readonly conversationId: string) {
    this.unobserve = observeConversationChannel({
      recover: (id) =>
        id && id !== this.conversationId ? Promise.resolve() : this.recover(),
      disconnected: () => {
        // Disconnection is not settlement. Keep known runtime state until an
        // authoritative snapshot replaces it, even if recovery fails.
        this.connected = false;
      },
      event: (event) => {
        if (event.conversationId !== this.conversationId) return;
        if (this.refreshing) this.buffered.push(event);
        else this.append(event);
      },
      notice: (notice) => {
        if (notice.type === "agentConfiguration.changed") {
          const scope = notice.data.scope;
          if (
            scope.scope === "user" ||
            (scope.scope === "project" &&
              scope.projectId === this.snapshot?.conversation.projectId) ||
            (scope.scope === "conversation" &&
              scope.conversationId === this.conversationId)
          )
            void this.refreshConfiguration().catch((error) => {
              this.error = errorMessage(error);
            });
          return;
        }
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
    // Configuration is independent of the event stream, so it overlaps the
    // snapshot and history requests. History must still start after the
    // snapshot: it has to include every event up to `snapshot.lastSequence`.
    const configuration = this.refreshConfiguration();
    configuration.catch(() => undefined);
    const snapshot = await requestConversation("conversation.getSnapshot", {
      conversationId: this.conversationId,
    });
    const history = await this.fetchHistory();
    await configuration;
    if (this.disposed) return;
    snapshot.conversation.headEventId = history.headEventId;
    this.clearLive();
    // Recovery is authoritative, including a null/absent operation after a
    // daemon restart. Buffered notices are revision-checked against this state.
    this.snapshot = snapshot;
    this.publishHistory(history);
    this.liveTurns.recover(
      this.events.flatMap((event) =>
        event.type === "assistant_message" && event.turnId
          ? [event.turnId]
          : [],
      ),
    );
    this.connected = true;
    this.deleted = false;
    installConversationReplaySequence(
      this.conversationId,
      snapshot.lastSequence,
    );
  }

  private append(event: TransferredConversationEvent): void {
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
    if (event.type === "assistant_message") {
      if (event.turnId) {
        this.liveTurns.finalize(event.turnId);
        // The persisted message supersedes any not-yet-committed text.
        this.liveDeltas.dropTurn(event.turnId);
      }
      this.liveBlocks = this.liveBlocks.filter(
        (block) => block.turnId !== event.turnId,
      );
    }
    if (event.type === "tool_call_response") {
      snapshot.toolCalls = snapshot.toolCalls.filter(
        (call) => call.id !== event.payload.toolCallId,
      );
      this.dropToolOutput(event.payload.toolCallId);
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
    ) {
      this.liveTurns.finalizeActive();
      this.clearLive();
    }
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
          // Only changed fields: summaries are republished with nested
          // objects that would otherwise always look new to readers.
          patchChanged(snapshot.conversation, notice.data.summary, false);
        else {
          const summary = notice.data.summary;
          const child = snapshot.children.find(
            (item) => item.id === summary.id,
          );
          if (child && summary.parentConversationId === this.conversationId)
            patchChanged(child, summary, true);
          else {
            snapshot.children = snapshot.children.filter(
              (item) => item.id !== summary.id,
            );
            if (summary.parentConversationId === this.conversationId)
              snapshot.children.push(summary);
          }
        }
        break;
      case "conversation.head":
        if (
          snapshot &&
          snapshot.conversation.headEventId !== notice.data.headEventId
        ) {
          snapshot.conversation.headEventId = notice.data.headEventId;
          this.liveTurns.finalizeActive();
          this.clearLive();
          void this.refreshHistory().catch((error) => {
            this.error = errorMessage(error);
          });
        }
        break;
      case "conversation.compaction":
        if (snapshot)
          snapshot.compaction = reconcileCompactionNotice(
            snapshot.compaction,
            notice.data.compaction,
          );
        break;
      case "conversation.config":
        // Config and the applied profile change together, so locks never lag the values.
        if (snapshot) {
          snapshot.config = notice.data.config;
        }
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
        else this.dropToolOutput(call.id);
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
    if (delta.type === "assistant_reset") {
      // The provider request restarted: drop the turn's ephemeral drafts.
      // liveTurns is untouched: the same turn keeps accepting new deltas.
      this.liveDeltas.dropTurn(delta.turnId);
      this.liveBlocks = resetLiveTurnBlocks(this.liveBlocks, delta.turnId);
      this.responseRevision += 1;
      return;
    }
    if (delta.type === "tool_progress") {
      this.liveDeltas.progress(delta.toolCallId, delta.update.chunk);
      return;
    }
    if (
      this.disposed ||
      this.deleted ||
      !this.snapshot ||
      !["running", "waiting"].includes(this.snapshot.conversation.status) ||
      !this.liveTurns.accept(delta.turnId)
    )
      return;
    if (delta.type === "assistant_text")
      this.liveDeltas.text(delta.turnId, delta.contentIndex, delta.delta);
    else if (delta.type === "assistant_thinking")
      this.liveDeltas.thinking(delta.turnId, delta.contentIndex, delta.delta);
    else
      this.liveDeltas.toolCall(delta.turnId, delta.contentIndex, {
        providerCallId: delta.providerCallId,
        name: delta.name,
        partialArgsText: delta.partialArgsText,
      });
  }

  private commitLive(batch: LiveBatch): void {
    if (this.disposed) return;
    if (batch.blocks.length)
      this.liveBlocks = applyLiveBatch(this.liveBlocks, batch.blocks);
    if (Object.keys(batch.toolOutput).length) {
      const next = { ...this.toolOutput };
      for (const [id, chunk] of Object.entries(batch.toolOutput))
        next[id] = (next[id] ?? "") + chunk;
      this.toolOutput = next;
    }
  }

  private dropToolOutput(toolCallId: string): void {
    this.liveDeltas.dropToolOutput(toolCallId);
    if (!(toolCallId in this.toolOutput)) return;
    const rest = { ...this.toolOutput };
    delete rest[toolCallId];
    this.toolOutput = rest;
  }

  private clearLive(): void {
    this.liveDeltas.clear();
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
        const history = await this.fetchHistory();
        if (this.disposed) return;
        if (head !== this.snapshot?.conversation.headEventId) {
          this.historyDirty = true;
          continue;
        }
        this.publishHistory(history);
      }
    })().finally(() => {
      this.historyRefresh = undefined;
    });
    return this.historyRefresh;
  }

  private async fetchHistory(): Promise<FetchedHistory> {
    const history = await fetchCompleteHistory(
      (page) =>
        requestConversation("conversation.getHistory", {
          conversationId: this.conversationId,
          ...page,
        }),
      HISTORY_PAGE_SIZE,
      () => this.disposed,
    );
    if (history.error) this.error = history.error;
    return history;
  }

  private publishHistory({ events, hasOlder }: FetchedHistory): void {
    this.events = events;
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
    this.hasOlder = hasOlder;
  }

  submit(text: string, inputId = createId("input")): Promise<null> {
    return requestConversation("input.submit", {
      conversationId: this.conversationId,
      inputId,
      text,
      source: "user",
    });
  }
  async refreshConfiguration(): Promise<void> {
    const generation = ++this.configurationGeneration;
    const [effective, configuration] = await Promise.all([
      requestConversation("agentConfiguration.getEffective", {
        conversationId: this.conversationId,
      }),
      requestConversation("agentConfiguration.get", {
        scope: { scope: "conversation", conversationId: this.conversationId },
      }),
    ]);
    if (this.disposed) return;
    if (generation !== this.configurationGeneration) return;
    this.effective = effective;
    this.configuration = configuration;
  }
  async configure(
    patch: Partial<Omit<ConversationConfig, "conversationId">>,
    resets: string[] = [],
  ): Promise<void> {
    const {
      model,
      reasoningLevel,
      permissionRuleSetId,
      systemPrompt,
      instructions,
      workingDirectory,
    } = patch;
    const context = {
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    };
    if (
      model !== undefined ||
      reasoningLevel !== undefined ||
      permissionRuleSetId !== undefined ||
      resets.length
    ) {
      const current = this.configuration;
      if (current?.status !== "available")
        throw new Error("Configuration unavailable. Refresh and try again.");
      const result = await requestConversation("agentConfiguration.save", {
        scope: { scope: "conversation", conversationId: this.conversationId },
        expectedRevision: current.source.revision,
        expectedDigest: current.source.digest,
        changes: {
          ...(model !== undefined ? { model } : {}),
          ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
          ...(permissionRuleSetId !== undefined ? { permissionRuleSetId } : {}),
        },
        resets,
      });
      await this.refreshConfiguration();
      if (result.status !== "saved")
        throw new Error(
          `Configuration ${result.status}. Refresh and try again.`,
        );
    }
    if (Object.keys(context).length)
      await requestConversation("conversation.configure", {
        conversationId: this.conversationId,
        patch: context,
      });
  }
  async setAgentProfile(profile: string): Promise<void> {
    try {
      await switchAgentProfile(this.conversationId, profile);
    } finally {
      await this.refreshConfiguration();
    }
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
    // Stop ends as idle; tell attention so it is not announced as a result.
    if (action === "stop") {
      suppressNextCompletion(this.conversationId);
      this.stopping = true;
      return requestConversation(`conversation.${action}`, {
        conversationId: this.conversationId,
      }).finally(() => (this.stopping = false));
    }
    return requestConversation(`conversation.${action}`, {
      conversationId: this.conversationId,
    });
  }
  /** Cancels a queued (not yet running) compaction request. */
  cancelCompaction(): Promise<null> {
    return requestConversation("conversation.cancelCompaction", {
      conversationId: this.conversationId,
    });
  }
  /** Cancels only the provider request and retries the same prepared context. */
  retryResponse(): Promise<null> {
    return requestConversation("conversation.retryResponse", {
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
  async resolve(
    toolCallId: string,
    resolution: InteractionResolution,
    resolutionRequestId = createId("input"),
  ): Promise<InteractionResolveResult> {
    const result = await requestConversation("interaction.resolve", {
      toolCallId,
      resolutionRequestId,
      resolution,
    });
    if (result.status === "applied") await this.refreshConfiguration();
    if (result.status === "refresh_required") await this.recover();
    return result;
  }
  selectHead(eventId: string | null): Promise<null> {
    return requestConversation("conversation.selectHead", {
      conversationId: this.conversationId,
      eventId,
    });
  }
  async loadHistoryTree(): Promise<void> {
    this.historyEvents ??= [...this.events];
    let sequence = 0;
    while (!this.disposed) {
      const events = await requestConversation("conversation.getEventsSince", {
        conversationId: this.conversationId,
        sequence,
      });
      if (this.disposed || events.length === 0) return;
      const nextSequence = Math.max(...events.map((event) => event.sequence));
      if (nextSequence <= sequence)
        throw new Error("History replay did not advance");
      const byId: Record<string, TransferredConversationEvent> =
        Object.fromEntries(
          [...events, ...(this.historyEvents ?? [])].map((event) => [
            event.id,
            event,
          ]),
        );
      this.historyEvents = Object.values(byId).sort(
        (a, b) => a.sequence - b.sequence,
      );
      sequence = nextSequence;
    }
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
    this.liveDeltas.dispose();
    this.unobserve();
    void unsubscribeConversation(this.conversationId).catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
