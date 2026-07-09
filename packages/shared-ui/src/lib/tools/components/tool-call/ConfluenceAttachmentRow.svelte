<script lang="ts">
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import type { ConfluenceAttachmentSummaryPayload } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { confluenceBytesLabel } from "../../views/confluence-display";
  import { basename } from "../../views/tool-presentation-helpers";

  type Props = {
    attachment: ConfluenceAttachmentSummaryPayload;
    expanded?: boolean;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { attachment, expanded = false, onOpenFile }: Props = $props();

  const name = $derived(
    attachment.filename ?? attachment.title ?? attachment.id ?? "attachment",
  );
  const sizeLabel = $derived(confluenceBytesLabel(attachment.fileSize));
  const hasChips = $derived(
    Boolean(
      attachment.mediaType || sizeLabel || attachment.versionNumber !== undefined,
    ),
  );
</script>

<div class="grid gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
  <div class="flex min-w-0 items-center gap-2">
    <Paperclip size={13} strokeWidth={2} class="shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">{name}</span>
  </div>

  {#if hasChips}
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {#if attachment.mediaType}
        <span class="text-xs text-muted-foreground">{attachment.mediaType}</span>
      {/if}
      {#if sizeLabel}
        <span class="text-xs text-muted-foreground">{sizeLabel}</span>
      {/if}
      {#if attachment.versionNumber !== undefined}
        <Badge tone="neutral" size="xs">v{attachment.versionNumber}</Badge>
      {/if}
    </div>
  {/if}

  {#if expanded && attachment.path}
    <button
      type="button"
      class="inline-flex min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-xs text-primary hover:underline"
      title={attachment.path}
      onclick={() => onOpenFile?.(attachment.path!)}
    >
      <span class="text-muted-foreground">File</span>
      <span class="truncate font-mono">{basename(attachment.path)}</span>
    </button>
  {/if}

  {#if expanded && attachment.snippet}
    <code class="block break-all text-xs text-muted-foreground">{attachment.snippet}</code>
  {/if}
</div>
