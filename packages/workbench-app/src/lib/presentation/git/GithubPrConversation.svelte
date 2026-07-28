<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import MessageSquare from "@lucide/svelte/icons/message-square";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type { GithubPrDetail } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nervekit/ui-kit/components/ui/card";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import { formatPrDate, prTimeline, reviewTone } from "./pr-pane-helpers";

type Props = { detail: GithubPrDetail };
let { detail }: Props = $props();
const timeline = $derived(prTimeline(detail));
</script>

<div class="space-y-4">
  <Card>
    <CardHeader class="border-b py-3">
      <CardTitle class="text-sm">
        {detail.author ?? "Unknown author"} opened this pull request
      </CardTitle>
    </CardHeader>
    <CardContent class="py-4">
      {#if detail.body.trim()}
        <Markdown text={detail.body} onCopy={notifyCopyResult} />
      {:else}
        <p class="text-sm text-muted-foreground">No description provided.</p>
      {/if}
    </CardContent>
  </Card>

  {#if timeline.length === 0}
    <div
      class="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground"
    >
      <MessageSquare class="size-4" />
      No comments or reviews yet.
    </div>
  {:else}
    <div class="space-y-3" aria-label="Pull request conversation">
      {#each timeline as entry (entry.kind + entry.value.id)}
        <Card>
          <CardHeader
            class="flex-row items-center justify-between gap-3 border-b py-2.5"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
              >
                {(entry.value.author ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <div class="min-w-0 text-sm">
                <strong class="text-foreground"
                  >{entry.value.author ?? "Deleted user"}</strong
                >
                <span class="ml-1 text-muted-foreground">
                  {entry.kind === "comment" ? "commented" : "reviewed"}
                  {formatPrDate(entry.at)}
                </span>
              </div>
              {#if entry.kind === "review"}
                <Badge tone={reviewTone(entry.value.state)} size="xs">
                  <ShieldCheck class="size-3" />
                  {entry.value.state.replaceAll("_", " ").toLowerCase()}
                </Badge>
              {/if}
            </div>
            {#if entry.value.url}
              <a
                href={entry.value.url}
                target="_blank"
                rel="noreferrer"
                class="text-muted-foreground hover:text-foreground"
                aria-label="Open this conversation item on GitHub"
              >
                <ExternalLink class="size-4" />
              </a>
            {/if}
          </CardHeader>
          <CardContent class="py-3">
            {#if entry.value.body.trim()}
              <Markdown text={entry.value.body} onCopy={notifyCopyResult} />
            {:else}
              <p class="text-sm text-muted-foreground">
                {entry.kind === "review"
                  ? "Submitted a review without a comment."
                  : "No comment body."}
              </p>
            {/if}
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}
</div>
