import { untrack } from "svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { retainConversationStore } from "$lib/features/conversations/state/open-conversation-stores";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import { conversationContext } from "$lib/features/conversations/adapters/core-context.adapter";
import {
  pendingWork as derivePendingWork,
  agentProfileLabel,
} from "$lib/features/conversations/agents/agent-team";
import type { PendingWorkItem } from "$lib/presentation/transcript/activity/run-activity";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

type Context = ReturnType<typeof conversationContext>;

export type ConversationAgentViewDependencies = {
  conversationId: () => string | undefined;
  /** Context of the viewed conversation (lead or sub-agent). */
  context: () => Context | undefined;
  /** Drops any entry being edited in the composer. */
  clearEdit: () => void;
  /** Drops state derived from the previous lead conversation. */
  resetTree: () => void;
};

/**
 * Which conversation a tab shows: the tab's lead, or one of its sub-agents in
 * its place. Owns the retained stores and everything derived from the view.
 */
export class ConversationAgentView {
  readonly #deps: ConversationAgentViewDependencies;
  /** The tab's conversation (the lead of its sub-agents). */
  leadStore = $state<ConversationStore>();
  /** A sub-agent shown in place of the lead's transcript, if any. */
  viewedChildId = $state<string>();
  childStore = $state<ConversationStore>();
  activityOpen = $state<"agents" | "commands" | null>(null);
  #releaseChild: (() => void) | undefined;

  /** Everything else acts on the conversation being viewed. */
  readonly store: ConversationStore | undefined = $derived(
    this.viewedChildId ? this.childStore : this.leadStore,
  );
  /** The lead's context drives the agents tree in both lead and sub-agent views. */
  readonly leadContext: Context | undefined;
  readonly viewedConversationId = $derived(
    this.viewedChildId ?? this.leadStore?.snapshot?.conversation.id,
  );
  readonly pendingWork = $derived(
    this.store?.snapshot
      ? derivePendingWork({
          children: this.store.snapshot.children,
          asyncBash: this.store.snapshot.asyncBash,
        })
      : [],
  );
  readonly viewedProfile = $derived.by(() => {
    const viewedId = this.viewedChildId;
    if (!viewedId) return undefined;
    const agent = this.leadContext?.conversationAgents.find(
      (candidate) => candidate.id === viewedId,
    );
    return agent ? agentProfileLabel(agent) : undefined;
  });
  readonly composerOverlay = $derived(
    this.viewedChildId
      ? {
          message: "Sub-agents take prompts only from their lead.",
          actionLabel: "Back to lead",
          onAction: () => this.viewAgent(undefined),
        }
      : undefined,
  );

  constructor(deps: ConversationAgentViewDependencies) {
    this.#deps = deps;
    this.leadContext = $derived(
      !this.viewedChildId
        ? this.#deps.context()
        : this.leadStore?.snapshot
          ? conversationContext(
              this.leadStore.snapshot,
              this.leadStore.events,
              settingsState.models,
            )
          : undefined,
    );
    $effect(() => () => untrack(() => this.viewAgent(undefined)));
    $effect(() => {
      if (this.viewedChildId && this.childStore?.deleted)
        this.viewAgent(undefined);
    });
    $effect(() => {
      const id = this.#deps.conversationId();
      this.leadStore = undefined;
      untrack(() => this.viewAgent(undefined));
      this.#deps.resetTree();
      this.#deps.clearEdit();
      if (!id) return;
      const retained = retainConversationStore(id);
      this.leadStore = retained.store;
      void retained.ready.catch((e) => notify.error(String(e)));
      return retained.release;
    });
  }

  /** Shows a sub-agent in the main view; the lead id (or none) returns. */
  viewAgent = (id: string | undefined): void => {
    this.#releaseChild?.();
    this.#releaseChild = undefined;
    this.childStore = undefined;
    this.viewedChildId = undefined;
    this.activityOpen = null;
    this.#deps.clearEdit();
    if (!id || id === this.#deps.conversationId()) return;
    const retained = retainConversationStore(id);
    this.#releaseChild = retained.release;
    this.childStore = retained.store;
    this.viewedChildId = id;
    void retained.ready.catch((e) => notify.error(String(e)));
  };

  openPendingWork = (item: PendingWorkItem): void => {
    if (item.kind === "agent") this.viewAgent(item.id);
    else this.activityOpen = "commands";
  };
}
