<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { CoreTimelineRow } from "../state/transcript-types";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type {
  ConversationPaneActions,
  ConversationMenuBuilders,
} from "../conversations/conversation-view-contracts";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import ToolCallCard from "../tools/ToolCallCard.svelte";
import UserMessageContent from "./UserMessageContent.svelte";
import RunStatusNoticeCard from "./notice/RunStatusNoticeCard.svelte";
import NoticeCard from "./notice/NoticeCard.svelte";
import TranscriptContextMenu from "./TranscriptContextMenu.svelte";
let {
  row,
  children = [],
  actions = {},
  menus,
}: {
  row: CoreTimelineRow;
  children?: ConversationSummary[];
  actions?: ConversationPaneActions;
  menus?: ConversationMenuBuilders;
} = $props();
const notice = $derived.by(() => {
  if (row.kind === "message" || row.kind === "tool") return undefined;
  if (row.kind === "run_status") return undefined;
  if (row.kind === "compaction")
    return {
      kind: "compaction",
      tone: "neutral" as const,
      glyph: "compaction" as const,
      busy: false,
      badge: "compacted",
      statusLabel: "Completed",
      summary: row.notice.summary,
      chips: [
        { text: `${row.notice.tokensBefore.toLocaleString()} tokens before` },
      ],
    };
  if (row.kind === "task_event")
    return {
      kind: "task_event",
      tone:
        row.notice.status === "failed"
          ? ("destructive" as const)
          : ("neutral" as const),
      glyph: "bell" as const,
      busy: false,
      badge: row.notice.event,
      statusLabel: row.notice.status,
      summary: row.notice.output,
      chips:
        row.notice.exitCode !== undefined
          ? [{ text: `exit ${row.notice.exitCode}` }]
          : [],
    };
  return {
    kind: "system_event",
    tone: "neutral" as const,
    glyph: row.notice.childConversationId
      ? ("subagent" as const)
      : ("system" as const),
    busy: false,
    badge: row.notice.kind,
    statusLabel: "Received",
    summary: row.notice.text,
    action:
      row.notice.childConversationId && actions.onOpenConversation
        ? {
            label: "Open",
            onClick: () =>
              actions.onOpenConversation?.(row.notice.childConversationId!),
          }
        : undefined,
  };
});
</script>
<TranscriptContextMenu
  target={row}
  menu={menus?.transcriptMenu ?? (() => [])}
  triggerClass="block select-text"
>
  {#if row.kind === "message"}
    <article
      class={`transcript-entry ${row.item.role} ${row.item.displayKind === "thinking" ? "thinking-entry" : ""} ${row.item.live ? "streaming" : ""}`}
      data-state={row.item.live ? "running" : "static"}
    >
      <div class="message-body">
        <div class="message-content">
          {#if row.item.role === "user"}<UserMessageContent
              text={row.item.text}
            />
            {#if row.item.preparedText}<details
                class="mt-2 text-xs text-muted-foreground"
              >
                <summary>Prepared prompt</summary><UserMessageContent
                  text={row.item.preparedText}
                />
              </details>{/if}
          {:else if row.item.displayKind === "thinking"}<details>
              <summary class="text-xs text-muted-foreground">Thinking</summary
              ><Markdown text={row.item.text} streaming={row.item.live} />
            </details>
          {:else}<Markdown
              text={row.item.text}
              streaming={row.item.live}
            />{/if}
        </div>
      </div>
      {#if row.item.role === "user" && row.item.previousEventId !== undefined && actions.onEditMessage}
        <div class="flex justify-end">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit and resend"
            onclick={() => {
              if (row.item.previousEventId !== undefined)
                actions.onEditMessage?.(
                  row.item.id,
                  row.item.text,
                  row.item.previousEventId,
                );
            }}><Pencil size={14} /></Button
          >
        </div>
      {/if}
    </article>
  {:else if row.kind === "tool"}<div class="relative min-w-0 px-3">
      <ToolCallCard toolCall={row.toolCall} {children} {actions} />
    </div>
  {:else if row.kind === "run_status"}
    <div class="relative min-w-0 px-3">
      <RunStatusNoticeCard
        notice={row.notice}
        onContinue={actions.onContinueFromFailure}
      />
    </div>
  {:else if notice}<div class="relative min-w-0 px-3">
      <NoticeCard {notice} />
    </div>{/if}
</TranscriptContextMenu>
