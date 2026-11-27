import type { Component } from "svelte";
import Blocks from "@lucide/svelte/icons/blocks";
import Library from "@lucide/svelte/icons/library";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import MessageCircleQuestionMark from "@lucide/svelte/icons/message-circle-question-mark";
import Play from "@lucide/svelte/icons/play";
import Plug from "@lucide/svelte/icons/plug";
import Shield from "@lucide/svelte/icons/shield";
import ShieldQuestionMark from "@lucide/svelte/icons/shield-question-mark";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Users from "@lucide/svelte/icons/users";
import type {
  ConfigurationResourceKind,
  ConfigurationReviewTarget,
} from "@nervekit/contracts/configuration";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import { deriveNeedsYou } from "$lib/application/activity/needs-you";
import { attentionIsland } from "$lib/application/attention-island/attention-island-state.svelte";
import {
  groupAttention,
  kindLabel,
  type AttentionEntry,
} from "$lib/application/configuration-attention/configuration-attention";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { openConfigurationReview } from "$lib/application/configuration-review/configuration-review-queue.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import {
  agoLabel,
  type IslandArrivalRow,
  type IslandConversationRow,
  type IslandTrustRow,
} from "$lib/presentation/activity/attention-island";
import type { NeedsYouInput } from "$lib/presentation/activity/notifications";

const KIND_ICONS: Record<ConfigurationResourceKind, Component> = {
  "agent-preferences": SlidersHorizontal,
  "agent-profile": Users,
  "rule-set": Shield,
  "permission-overlay": Shield,
  "launch-catalog": Play,
  "mcp-servers": Plug,
  skill: Library,
  "prompt-suggestion": Lightbulb,
  extension: Blocks,
};

type PendingInputKind = NonNullable<NeedsYouInput["pendingInput"]>;

const WAITS: Record<PendingInputKind, string> = {
  user_input: "asks a question",
  approval: "waits for your approval",
  configuration_blocked: "waits for your approval",
  plan_review: "has a plan for you to review",
};

function trustTarget(
  entry: AttentionEntry,
  projectId: string | undefined,
): ConfigurationReviewTarget {
  return {
    kind: entry.kind,
    scope: entry.scope,
    ...(entry.scope === "project" && projectId ? { projectId } : {}),
    id: entry.id,
  };
}

/**
 * What the bell island and the transcript marker show: configuration waiting
 * for trust (with the risk line from its review) and conversations waiting for
 * an answer. Shared by the titlebar, every conversation pane and the watcher
 * that feeds the island's arrivals.
 */
class AttentionIslandModel {
  readonly trustEntries = $derived(
    groupAttention(configurationAttention.entries).review,
  );

  readonly trustItems = $derived(
    this.trustEntries.map((entry) => ({
      key: entry.key,
      target: trustTarget(entry, configurationAttention.projectId),
    })),
  );

  readonly trustRows: IslandTrustRow[] = $derived(
    this.trustEntries.map((entry) => {
      const review = attentionIsland.reviews[entry.key];
      const time = review?.changedAt
        ? agoLabel(relativeTimeLabel(review.changedAt))
        : "";
      return {
        key: entry.key,
        name: review?.name ?? entry.id,
        kindLabel: review?.kindLabel ?? kindLabel(entry.kind),
        scopeLabel: entry.scope === "project" ? "Project" : "User",
        icon: KIND_ICONS[entry.kind],
        risk: review?.items.find((item) => item.broad)?.short,
        ...(review
          ? {
              changed: [review.changedSinceDecision ? "changed" : "added", time]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
      };
    }),
  );

  readonly waiting: NeedsYouInput[] = $derived(
    deriveNeedsYou({
      conversations: workspaceSelectors.conversations,
      activityById: workspaceSelectors.conversationActivityById,
      projectNameById: Object.fromEntries(
        workspaceSelectors.projects.map((project) => [
          project.id,
          project.name,
        ]),
      ),
    }).filter((entry) => entry.kind === "attention"),
  );

  readonly conversationRows: IslandConversationRow[] = $derived(
    this.waiting.map((entry) => ({
      key: entry.id,
      conversationId: entry.conversationId,
      title: entry.conversationTitle || "Untitled conversation",
      project: entry.projectName,
      waits: entry.pendingInput
        ? WAITS[entry.pendingInput]
        : "needs your attention",
      time: agoLabel(relativeTimeLabel(entry.at)),
      icon:
        entry.pendingInput === "approval" ||
        entry.pendingInput === "configuration_blocked"
          ? ShieldQuestionMark
          : MessageCircleQuestionMark,
    })),
  );

  readonly counts = $derived({
    trust: this.trustEntries.length,
    conversations: this.waiting.length,
  });

  /** The item the island shows on one line, while it arrives. */
  readonly arrival: IslandArrivalRow | undefined = $derived.by(() => {
    const arrival = attentionIsland.state.arrival;
    if (!arrival) return undefined;
    if (arrival.level === "trust") {
      const row = this.trustRows.find((entry) => entry.key === arrival.key);
      return row ? { level: "trust", row } : undefined;
    }
    const row = this.conversationRows.find(
      (entry) => entry.key === arrival.key,
    );
    return row ? { level: "conversation", row } : undefined;
  });

  /** Opens the review dialog on every waiting item, from `key` (or the first). */
  review(key?: string): void {
    const targets = this.trustItems.map((item) => item.target);
    const index = key
      ? Math.max(
          0,
          this.trustItems.findIndex((item) => item.key === key),
        )
      : 0;
    attentionIsland.dismiss();
    openConfigurationReview(targets, index);
  }

  /** Goes to the conversation; its item stays until it is answered. */
  openConversation(row: IslandConversationRow): void {
    attentionIsland.dismiss();
    void openConversation(row.conversationId);
  }
}

export const attentionIslandModel = new AttentionIslandModel();
