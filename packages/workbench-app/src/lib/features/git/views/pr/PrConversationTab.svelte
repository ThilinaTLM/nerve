<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import ExternalLink from "@lucide/svelte/icons/external-link";
import MessageSquare from "@lucide/svelte/icons/message-square";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { Component } from "svelte";
import type {
  GithubPrConversation,
  GithubPrCore,
  GithubPrLabel,
} from "@nervekit/contracts/git";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import { cn } from "@nervekit/ui-kit/utils";
import type { PrLinkedConversation } from "../github-pr-types";
import {
  formatPrDateCompact,
  formatRelativeAge,
  prTimeline,
  type PrReviewer,
} from "../pr-pane-helpers";
import PrAvatar from "./PrAvatar.svelte";
import PrDetails from "./PrDetails.svelte";
import PrTooltip from "./PrTooltip.svelte";

type Props = {
  core: GithubPrCore;
  conversation: GithubPrConversation;
  reviewers: PrReviewer[];
  labels: GithubPrLabel[];
  linked: PrLinkedConversation[];
  onOpenConversation?: (id: string) => void;
};
let {
  core,
  conversation,
  reviewers,
  labels,
  linked,
  onOpenConversation,
}: Props = $props();

let detailsOpen = $state(false);
const timeline = $derived(prTimeline(conversation));
const hasDetails = $derived(
  reviewers.length > 0 || labels.length > 0 || linked.length > 0,
);

const REVIEW_STATE: Record<
  string,
  { label: string; icon: Component; tone: string }
> = {
  APPROVED: { label: "Approved", icon: CircleCheck, tone: "text-success" },
  CHANGES_REQUESTED: {
    label: "Requested changes",
    icon: TriangleAlert,
    tone: "text-warning",
  },
  COMMENTED: {
    label: "Reviewed",
    icon: MessageSquare,
    tone: "text-muted-foreground",
  },
  DISMISSED: {
    label: "Dismissed review",
    icon: MessageSquare,
    tone: "text-muted-foreground",
  },
};
</script>

{#snippet details()}
  <PrDetails {reviewers} {labels} {linked} {onOpenConversation} />
{/snippet}

<ScrollArea class="h-full" viewportClass="@container">
  <div
    class="grid max-w-6xl gap-x-10 px-4 pt-2 pb-10 @3xl:grid-cols-[minmax(0,48rem)_minmax(15rem,1fr)]"
  >
    {#if hasDetails}
      <Collapsible.Root bind:open={detailsOpen} class="border-b @3xl:hidden">
        <Collapsible.Trigger
          class="flex w-full items-center gap-1.5 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            class={cn(
              "size-3.5 transition-transform",
              detailsOpen && "rotate-90",
            )}
            aria-hidden="true"
          />
          Details
        </Collapsible.Trigger>
        <Collapsible.Content>{@render details()}</Collapsible.Content>
      </Collapsible.Root>
    {/if}

    <div class="max-w-3xl min-w-0 py-4">
      <!-- Description: the opening post, read like a document. -->
      <p class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <PrAvatar name={core.author} large />
        <span class="text-sm font-medium text-foreground"
          >{core.author ?? "Unknown author"}</span
        >
        opened {formatRelativeAge(core.createdAt)}
      </p>
      {#if conversation.body.trim()}
        <div class="text-sm leading-relaxed">
          <Markdown text={conversation.body} onCopy={notifyCopyResult} />
        </div>
      {:else}
        <p class="text-sm text-muted-foreground">No description provided.</p>
      {/if}

      <section class="mt-8 border-t pt-4" aria-labelledby="pr-activity">
        <h2
          id="pr-activity"
          class="mb-4 text-xs font-medium text-muted-foreground"
        >
          Activity
        </h2>
        {#if timeline.length === 0}
          <p class="text-xs text-muted-foreground">No comments yet.</p>
        {:else}
          <ol
            class="relative flex flex-col before:absolute before:inset-y-3 before:left-3 before:w-px before:bg-border"
          >
            {#each timeline as entry (entry.kind + entry.value.id)}
              {@const review =
                entry.kind === "review"
                  ? REVIEW_STATE[entry.value.state]
                  : undefined}
              {@const ReviewIcon = review?.icon}
              <li class="relative py-2 pl-10">
                <span
                  class="absolute top-2 left-0 rounded-full ring-4 ring-background"
                >
                  <PrAvatar name={entry.value.author} large />
                </span>
                <div class="overflow-hidden rounded-md border bg-card">
                  <p
                    class="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/40 px-3 py-1"
                  >
                    <span class="text-sm font-medium"
                      >{entry.value.author ?? "Deleted user"}</span
                    >
                    {#if review && ReviewIcon}
                      <span
                        class={cn(
                          "inline-flex items-center gap-1 text-xs",
                          review.tone,
                        )}
                      >
                        <ReviewIcon
                          class="size-3.5"
                          aria-hidden="true"
                        />{review.label}
                      </span>
                    {/if}
                    <PrTooltip label={formatPrDateCompact(entry.at)}>
                      <span class="text-xs text-muted-foreground"
                        >{formatRelativeAge(entry.at)}</span
                      >
                    </PrTooltip>
                    {#if entry.value.url}
                      <span class="ml-auto">
                        <IconAction
                          icon={ExternalLink}
                          label="Open on GitHub"
                          class="-my-1"
                          onclick={() =>
                            window.open(entry.value.url, "_blank", "noopener")}
                        />
                      </span>
                    {/if}
                  </p>
                  {#if entry.value.body.trim()}
                    <div class="px-3 py-2 text-sm">
                      <Markdown
                        text={entry.value.body}
                        onCopy={notifyCopyResult}
                      />
                    </div>
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    </div>

    {#if hasDetails}
      <aside class="hidden @3xl:block" aria-label="Details">
        {@render details()}
      </aside>
    {/if}
  </div>
</ScrollArea>
