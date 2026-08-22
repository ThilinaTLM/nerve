<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import MessageSquare from "@lucide/svelte/icons/message-square";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type { GithubPrConversation, GithubPrCore } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import GithubPrSection from "./GithubPrSection.svelte";
import PrAvatar from "./PrAvatar.svelte";
import PrCollapsibleBody from "./PrCollapsibleBody.svelte";
import {
  formatPrDate,
  formatRelativePrDate,
  prTimeline,
  reviewSurfaceClass,
  reviewTone,
  shouldCollapseBody,
} from "./pr-pane-helpers";

type Props = { core: GithubPrCore; conversation: GithubPrConversation };
let { core, conversation }: Props = $props();
const timeline = $derived(prTimeline(conversation));
</script>

{#snippet entryBody(body: string)}
  {#if shouldCollapseBody(body)}
    <PrCollapsibleBody {body} />
  {:else if body.trim()}
    <div class="text-sm">
      <Markdown text={body} onCopy={notifyCopyResult} />
    </div>
  {/if}
{/snippet}

<div class="flex flex-col gap-2">
  <GithubPrSection>
    {#snippet header()}
      <span class="min-w-0 flex-1 truncate">
        <strong class="font-semibold text-foreground"
          >{core.author ?? "Unknown author"}</strong
        >
        <span class="text-muted-foreground">
          opened this pull request {formatRelativePrDate(core.createdAt)}
        </span>
      </span>
    {/snippet}
    {#if conversation.body.trim()}
      {@render entryBody(conversation.body)}
    {:else}
      <p class="text-xs text-muted-foreground">No description provided.</p>
    {/if}
  </GithubPrSection>

  {#if timeline.length === 0}
    <p class="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
      <MessageSquare class="size-3.5" aria-hidden="true" />
      No comments or reviews yet.
    </p>
  {:else}
    <div class="flex flex-col gap-2" aria-label="Pull request conversation">
      {#each timeline as entry (entry.kind + entry.value.id)}
        {@const body = entry.value.body}
        <GithubPrSection
          class={entry.kind === "review"
            ? reviewSurfaceClass(entry.value.state)
            : ""}
        >
          {#snippet header()}
            <PrAvatar
              name={entry.value.author}
              src={entry.value.authorAvatarUrl}
              class="size-5"
            />
            <span class="min-w-0 flex-1 truncate">
              <strong class="font-semibold text-foreground"
                >{entry.value.author ?? "Deleted user"}</strong
              >
              <span class="text-muted-foreground">
                {entry.kind === "comment" ? "commented" : "reviewed"}
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        type="button"
                        class="inline cursor-help rounded-xs hover:text-foreground"
                      >
                        {formatRelativePrDate(entry.at)}
                      </button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content sideOffset={5}>
                    {formatPrDate(entry.at)}
                  </Tooltip.Content>
                </Tooltip.Root>
              </span>
            </span>
            {#if entry.kind === "review"}
              <Badge tone={reviewTone(entry.value.state)} size="xs">
                <ShieldCheck class="size-3" />
                {entry.value.state.replaceAll("_", " ").toLowerCase()}
              </Badge>
            {/if}
          {/snippet}
          {#snippet actions()}
            {#if entry.value.url}
              <a
                href={entry.value.url}
                target="_blank"
                rel="noreferrer"
                class="text-muted-foreground hover:text-foreground"
                aria-label="Open this conversation item on GitHub"
              >
                <ExternalLink class="size-3.5" />
              </a>
            {/if}
          {/snippet}
          {#if body.trim()}
            {@render entryBody(body)}
          {:else if entry.kind === "review"}
            <p class="text-xs text-muted-foreground">
              Submitted a review without a comment.
            </p>
          {/if}
        </GithubPrSection>
      {/each}
    </div>
  {/if}
</div>
