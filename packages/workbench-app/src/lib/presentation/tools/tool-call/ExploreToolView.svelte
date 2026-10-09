<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { CoreToolCard } from "../../state/transcript-types";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
let {
  toolCall,
  children = [],
  onOpenConversation,
  onPeekConversation,
}: {
  toolCall?: CoreToolCard;
  children?: ConversationSummary[];
  onOpenConversation?: (id: string) => void;
  onPeekConversation?: (id: string, title: string) => void;
} = $props();
function tone(status: ConversationSummary["status"]): StatusTone {
  return status === "running"
    ? "info"
    : status === "failed"
      ? "destructive"
      : "warning";
}
const reports = $derived.by(() => {
  const byId = new SvelteMap<string, string>();
  try {
    const value: unknown = JSON.parse(toolCall?.resultPreview?.content ?? "");
    if (Array.isArray(value))
      for (const report of value)
        if (
          report &&
          typeof report.conversationId === "string" &&
          typeof report.report === "string"
        )
          byId.set(report.conversationId, report.report);
  } catch {
    /* Text-only delegation response. */
  }
  return byId;
});
const displayed = $derived(
  toolCall?.id
    ? children.filter((child) => child.parentToolCallId === toolCall.id)
    : [],
);
</script>
<div class="flex flex-col gap-2">
  {#each displayed as child (child.id)}
    <div class="flex min-w-0 items-center gap-2 py-1">
      {#if child.status !== "idle"}<StatusDot tone={tone(child.status)} />{/if}
      <span class="min-w-0 flex-1 truncate text-sm">{child.title}</span>
      {#if onPeekConversation}<Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Peek at ${child.title}`}
          onclick={() => onPeekConversation?.(child.id, child.title)}
          ><MessagesSquare size={13} /></Button
        >{/if}
      {#if onOpenConversation}<Button
          variant="ghost"
          size="xs"
          onclick={() => onOpenConversation?.(child.id)}
          ><ArrowUpRight size={13} />Open</Button
        >{/if}
    </div>
    {#if reports.get(child.id)}<details class="rounded-md bg-well p-3 text-sm">
        <summary class="text-xs text-muted-foreground">Report</summary><Markdown
          text={reports.get(child.id)!}
        />
      </details>{/if}
  {/each}
  {#if displayed.length === 0}<p class="text-xs text-muted-foreground">
      {toolCall?.statusLabel ?? "Child conversations"}
    </p>{/if}
</div>
