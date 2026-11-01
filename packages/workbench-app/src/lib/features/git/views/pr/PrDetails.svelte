<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Clock from "@lucide/svelte/icons/clock";
import MessageSquare from "@lucide/svelte/icons/message-square";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { Component } from "svelte";
import type { GithubPrLabel } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { cn } from "@nervekit/ui-kit/utils";
import ConversationListItem from "$lib/presentation/conversations/ConversationListItem.svelte";
import { PanelList } from "$lib/presentation/panels";
import type { PrLinkedConversation } from "../github-pr-types";
import type { PrReviewer, PrReviewerState } from "../pr-pane-helpers";
import PrAvatar from "./PrAvatar.svelte";

type Props = {
  reviewers: PrReviewer[];
  labels: GithubPrLabel[];
  linked: PrLinkedConversation[];
  /** The PR's `host/owner/repo` key, used to shorten reference labels. */
  repository?: string;
  onOpenConversation?: (id: string) => void;
};
let { reviewers, labels, linked, repository, onOpenConversation }: Props =
  $props();

const VISIBLE_LINKED = 3;
let showAllLinked = $state(false);
const shownLinked = $derived(
  showAllLinked ? linked : linked.slice(0, VISIBLE_LINKED),
);

const REVIEWER: Record<
  PrReviewerState,
  { short: string; icon: Component; tone: string }
> = {
  approved: { short: "Approved", icon: Check, tone: "text-success" },
  changes: { short: "Changes", icon: TriangleAlert, tone: "text-warning" },
  requested: { short: "Pending", icon: Clock, tone: "text-muted-foreground" },
  commented: {
    short: "Commented",
    icon: MessageSquare,
    tone: "text-muted-foreground",
  },
};
</script>

<div class="flex flex-col gap-5 py-3">
  {#if reviewers.length > 0}
    <section>
      <h3 class="pb-1.5 text-ui font-medium text-muted-foreground">
        Reviewers
      </h3>
      <ul class="divide-y overflow-hidden rounded-md border bg-card">
        {#each reviewers as reviewer (reviewer.login)}
          {@const meta = REVIEWER[reviewer.state]}
          {@const Icon = meta.icon}
          <li class="flex items-center gap-2 px-3 py-1.5 text-ui">
            <PrAvatar name={reviewer.login} />
            <span class="min-w-0 flex-1 truncate">{reviewer.login}</span>
            <span
              class={cn(
                "inline-flex shrink-0 items-center gap-1 text-ui",
                meta.tone,
              )}
            >
              <Icon class="size-3.5" aria-hidden="true" />{meta.short}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if labels.length > 0}
    <section>
      <h3 class="pb-1.5 text-ui font-medium text-muted-foreground">Labels</h3>
      <div class="flex flex-wrap gap-1.5 rounded-md border bg-card px-3 py-2">
        {#each labels as label (label.name)}
          <Badge variant="outline">
            {#if label.color && /^[0-9a-f]{6}$/i.test(label.color)}
              <span
                class="size-2 rounded-full"
                style:background-color={`#${label.color}`}
                aria-hidden="true"
              ></span>
            {/if}
            {label.name}
          </Badge>
        {/each}
      </div>
    </section>
  {/if}

  {#if linked.length > 0}
    <section>
      <h3 class="pb-1.5 text-ui font-medium text-muted-foreground">
        Conversations
      </h3>
      <PanelList
        ariaLabel="Linked conversations"
        class="overflow-hidden rounded-md border bg-card"
      >
        {#each shownLinked as item (item.conversation.id)}
          <ConversationListItem
            conversation={item.conversation}
            activity={item.activity}
            currentRepository={repository}
            {onOpenConversation}
          />
        {/each}
      </PanelList>
      {#if linked.length > VISIBLE_LINKED}
        <button
          type="button"
          class="mt-1.5 text-ui text-muted-foreground hover:text-foreground"
          onclick={() => (showAllLinked = !showAllLinked)}
        >
          {showAllLinked
            ? "Show fewer"
            : `Show ${linked.length - VISIBLE_LINKED} more`}
        </button>
      {/if}
    </section>
  {/if}
</div>
