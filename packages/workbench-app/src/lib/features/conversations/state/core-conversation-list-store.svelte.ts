import { SvelteMap } from "svelte/reactivity";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  isConversationChannelReady,
  observeConversationChannel,
  requestConversation,
  type ConversationNotice,
} from "$lib/application/startup/conversation-connection";

/** Project navigation consumes only summaries, never transcript/live state. */
export class ConversationListStore {
  roots = $state<ConversationSummary[]>([]);
  children = $state<Record<string, ConversationSummary[]>>({});
  expanded = $state<Record<string, boolean>>({});
  loading = $state(false);
  error = $state<string>();
  private refreshing: Promise<void> | undefined;
  private readonly childLoads = new SvelteMap<string, Promise<void>>();
  private readonly childNotices = new SvelteMap<string, ConversationNotice[]>();
  private buffered: ConversationNotice[] = [];
  private disposed = false;
  private readonly unobserve: () => void;

  constructor(readonly projectId: string) {
    this.unobserve = observeConversationChannel({
      recover: (id) => (id ? Promise.resolve() : this.recover()),
      disconnected: () => undefined,
      event: () => undefined,
      notice: (notice) => {
        if (
          (notice.type !== "conversation.changed" &&
            notice.type !== "conversation.deleted") ||
          notice.data.projectId !== this.projectId
        )
          return;
        for (const notices of this.childNotices.values()) notices.push(notice);
        if (this.refreshing) this.buffered.push(notice);
        else this.applyNotice(notice);
      },
    });
  }

  open(): Promise<void> {
    return this.recover();
  }

  recover(): Promise<void> {
    if (this.disposed || !isConversationChannelReady())
      return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.loading = true;
    this.error = undefined;
    this.refreshing = (async () => {
      const roots = await requestConversation("conversation.list", {
        projectId: this.projectId,
        parentConversationId: null,
      });
      if (this.disposed) return;
      this.roots = order(roots);
      const parents = Object.keys(this.expanded).filter(
        (id) => this.expanded[id],
      );
      await Promise.all(parents.map((parent) => this.loadChildren(parent)));
    })()
      .catch((error) => {
        this.error = message(error);
        throw error;
      })
      .finally(() => {
        this.refreshing = undefined;
        this.loading = false;
        const buffered = this.buffered;
        this.buffered = [];
        if (!this.disposed)
          for (const notice of buffered) this.applyNotice(notice);
      });
    return this.refreshing;
  }

  async toggleChildren(parentConversationId: string): Promise<void> {
    this.expanded[parentConversationId] = !this.expanded[parentConversationId];
    if (this.expanded[parentConversationId])
      await this.loadChildren(parentConversationId);
  }

  loadChildren(parentConversationId: string): Promise<void> {
    const existing = this.childLoads.get(parentConversationId);
    if (existing) return existing;
    const notices: ConversationNotice[] = [];
    // Child expansion snapshots need the same notice buffering as reconnect.
    this.childNotices.set(parentConversationId, notices);
    const pending = requestConversation("conversation.list", {
      projectId: this.projectId,
      parentConversationId,
    })
      .then((children) => {
        if (this.disposed) return;
        this.children[parentConversationId] = order(children);
        for (const notice of notices) this.applyNotice(notice);
      })
      .catch((error) => {
        this.error = message(error);
        throw error;
      })
      .finally(() => {
        this.childNotices.delete(parentConversationId);
        this.childLoads.delete(parentConversationId);
      });
    this.childLoads.set(parentConversationId, pending);
    return pending;
  }

  private applyNotice(notice: ConversationNotice): void {
    if (notice.type === "conversation.deleted") {
      const id = notice.data.conversationId;
      this.roots = this.roots.filter((row) => row.id !== id);
      for (const parent of Object.keys(this.children))
        this.children[parent] = this.children[parent].filter(
          (row) => row.id !== id,
        );
      delete this.children[id];
      delete this.expanded[id];
    } else if (notice.type === "conversation.changed") {
      const summary = notice.data.summary;
      this.roots = this.roots.filter((row) => row.id !== summary.id);
      for (const parent of Object.keys(this.children))
        this.children[parent] = this.children[parent].filter(
          (row) => row.id !== summary.id,
        );
      if (summary.parentConversationId === null)
        this.roots = order([...this.roots, summary]);
      else if (this.children[summary.parentConversationId])
        this.children[summary.parentConversationId] = order([
          ...this.children[summary.parentConversationId],
          summary,
        ]);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unobserve();
  }
}

function order(rows: ConversationSummary[]): ConversationSummary[] {
  return [...rows].sort((a, b) => {
    if (a.pinnedAt !== b.pinnedAt) {
      if (!a.pinnedAt) return 1;
      if (!b.pinnedAt) return -1;
      return b.pinnedAt.localeCompare(a.pinnedAt);
    }
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
