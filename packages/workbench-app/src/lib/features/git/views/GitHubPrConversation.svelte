<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import MessageSquare from "@lucide/svelte/icons/message-square";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type {
  GithubPrConversation,
  GithubPrCore,
} from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import GitHubPrSection from "./GitHubPrSection.svelte";
import { formatPrDate, prTimeline, reviewTone } from "./pr-pane-helpers";

type Props = { core: GithubPrCore; conversation: GithubPrConversation };
let { core, conversation }: Props = $props();
const timeline = $derived(prTimeline(conversation));
</script>

<div class="flex flex-col gap-2">
  <GitHubPrSection>
    {#snippet header()}
      <span class="min-w-0 flex-1 truncate">
        <strong class="font-semibold text-foreground"
          >{core.author ?? "Unknown author"}</strong
        >
        <span class="text-muted-foreground">
          opened this pull request {formatPrDate(core.createdAt)}</span
        >
      </span>
    {/snippet}
    {#if conversation.body.trim()}
      <div class="text-sm">
        <Markdown text={conversation.body} onCopy={notifyCopyResult} />
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">No description provided.</p>
    {/if}
  </GitHubPrSection>

  {#if timeline.length === 0}
    <p
      class="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground"
    >
      <MessageSquare class="size-3.5" aria-hidden="true" />
      No comments or reviews yet.
    </p>
  {:else}
    <div class="flex flex-col gap-2" aria-label="Pull request conversation">
      {#each timeline as entry (entry.kind + entry.value.id)}
        <GitHubPrSection>
          {#snippet header()}
            <span
              class="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
            >
              {(entry.value.author ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span class="min-w-0 flex-1 truncate">
              <strong class="font-semibold text-foreground"
                >{entry.value.author ?? "Deleted user"}</strong
              >
              <span class="text-muted-foreground">
                {entry.kind === "comment" ? "commented" : "reviewed"}
                {formatPrDate(entry.at)}</span
              >
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
          {#if entry.value.body.trim()}
            <div class="text-sm">
              <Markdown text={entry.value.body} onCopy={notifyCopyResult} />
            </div>
          {:else}
            <p class="text-xs text-muted-foreground">
              {entry.kind === "review"
                ? "Submitted a review without a comment."
                : "No comment body."}
            </p>
          {/if}
        </GitHubPrSection>
      {/each}
    </div>
  {/if}
</div>
