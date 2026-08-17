<script lang="ts">
import CalendarRange from "@lucide/svelte/icons/calendar-range";
import Columns3 from "@lucide/svelte/icons/columns-3";
import ExternalLink from "@lucide/svelte/icons/external-link";
import File from "@lucide/svelte/icons/file";
import FileText from "@lucide/svelte/icons/file-text";
import FolderKanban from "@lucide/svelte/icons/folder-kanban";
import Link2 from "@lucide/svelte/icons/link-2";
import MessageSquare from "@lucide/svelte/icons/message-square";
import Tags from "@lucide/svelte/icons/tags";
import Timer from "@lucide/svelte/icons/timer";
import User from "@lucide/svelte/icons/user";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { BadgeTone } from "@nervekit/ui-kit/components/ui/badge";

type ResourceIcon =
  | "board"
  | "sprint"
  | "file"
  | "page"
  | "project"
  | "user"
  | "comment"
  | "worklog"
  | "link"
  | "label";
type Props = {
  icon: ResourceIcon;
  id?: string;
  title?: string;
  detail?: string;
  href?: string;
  status?: string;
  statusTone?: BadgeTone;
};

let {
  icon,
  id,
  title,
  detail,
  href,
  status,
  statusTone = "neutral",
}: Props = $props();

const Icon = $derived(
  icon === "board"
    ? Columns3
    : icon === "sprint"
      ? CalendarRange
      : icon === "file"
        ? File
        : icon === "page"
          ? FileText
          : icon === "project"
            ? FolderKanban
            : icon === "user"
              ? User
              : icon === "comment"
                ? MessageSquare
                : icon === "worklog"
                  ? Timer
                  : icon === "link"
                    ? Link2
                    : Tags,
);
</script>

<div class="flex min-w-0 gap-2 px-2.5 py-2">
  <Icon
    size={14}
    strokeWidth={2}
    class="mt-0.5 shrink-0 text-muted-foreground"
  />
  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      {#if id}
        {#if href}
          <a
            {href}
            target="_blank"
            rel="noreferrer noopener"
            class="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary no-underline hover:underline"
          >
            {id}<ExternalLink size={11} strokeWidth={2} class="opacity-70" />
          </a>
        {:else}
          <span class="font-mono text-xs font-semibold text-foreground"
            >{id}</span
          >
        {/if}
      {/if}
      {#if title}
        <span
          class="min-w-0 break-words text-xs font-medium leading-snug text-sidebar-foreground"
          >{title}</span
        >
      {/if}
      {#if status}
        <Badge tone={statusTone} size="xs" class="ml-auto">{status}</Badge>
      {/if}
    </div>
    {#if detail}
      <p
        class="m-0 mt-0.5 whitespace-pre-wrap text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]"
      >
        {detail}
      </p>
    {/if}
  </div>
</div>
