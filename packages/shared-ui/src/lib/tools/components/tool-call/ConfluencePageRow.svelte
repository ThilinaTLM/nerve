<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FileText from "@lucide/svelte/icons/file-text";
  import type { ConfluencePageSummaryPayload } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import {
    confluencePageUrl,
    confluenceStatusBadgeTone,
  } from "../../views/confluence-display";
  import { basename } from "../../views/tool-presentation-helpers";

  type Props = {
    page: ConfluencePageSummaryPayload;
    siteUrl?: string;
    expanded?: boolean;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { page, siteUrl, expanded = false, onOpenFile }: Props = $props();

  const url = $derived(confluencePageUrl(siteUrl, page.webui));
  const hasChips = $derived(
    Boolean(
      page.status ||
        page.versionNumber !== undefined ||
        page.spaceKey ||
        page.parentId,
    ),
  );
  const files = $derived(
    [
      page.storagePath ? { label: "Storage", path: page.storagePath } : undefined,
      page.markdownPath ? { label: "Markdown", path: page.markdownPath } : undefined,
      page.attachmentDir
        ? { label: "Attachments", path: page.attachmentDir }
        : undefined,
    ].filter((entry): entry is { label: string; path: string } => Boolean(entry)),
  );
</script>

<div class="grid gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
  <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
    <span class="inline-flex items-center gap-1.5">
      <FileText size={13} strokeWidth={2} class="shrink-0 text-muted-foreground" />
      {#if url}
        <a
          class="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary no-underline hover:underline"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          title={`Open ${page.id} in Confluence`}
        >
          {page.id}
          <ExternalLink size={11} strokeWidth={2} class="opacity-70" />
        </a>
      {:else}
        <span class="font-mono text-xs font-semibold text-sidebar-foreground">{page.id}</span>
      {/if}
    </span>
    {#if page.title}
      <span class="min-w-0 break-words text-xs font-medium leading-snug text-sidebar-foreground">{page.title}</span>
    {/if}
  </div>

  {#if hasChips}
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {#if page.status}
        <Badge tone={confluenceStatusBadgeTone(page.status)} size="xs">{page.status}</Badge>
      {/if}
      {#if page.versionNumber !== undefined}
        <Badge tone="neutral" size="xs">v{page.versionNumber}</Badge>
      {/if}
      {#if page.spaceKey}
        <span class="text-xs text-muted-foreground">Space {page.spaceKey}</span>
      {/if}
      {#if page.parentId}
        <span class="text-xs text-muted-foreground">Parent <code>{page.parentId}</code></span>
      {/if}
    </div>
  {/if}

  {#if expanded && files.length > 0}
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {#each files as file (file.path)}
        <button
          type="button"
          class="inline-flex min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-primary hover:underline"
          title={file.path}
          onclick={() => onOpenFile?.(file.path)}
        >
          <span class="text-muted-foreground">{file.label}</span>
          <span class="truncate font-mono">{basename(file.path)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
