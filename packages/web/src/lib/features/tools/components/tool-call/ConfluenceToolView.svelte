<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Database from "@lucide/svelte/icons/database";
  import FileText from "@lucide/svelte/icons/file-text";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import type { Component } from "svelte";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import { confluenceBytesLabel, confluencePageUrl } from "$lib/features/tools/views/confluence-display";
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import { COLLAPSED_LINES } from "$lib/features/tools/views/tool-result-view";

  type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: ConfluenceView;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();

  const ITEM_LIMIT = COLLAPSED_LINES;
  const siteUrl = $derived(settingsState.settingsDraft?.tools?.confluence?.siteUrl);
  const bannerText = $derived(view.messageLines[0]);

  function cap<T>(items: T[]): T[] {
    return expanded ? items : items.slice(0, ITEM_LIMIT);
  }

  function fullUrl(webui: string | undefined): string | undefined {
    return confluencePageUrl(siteUrl, webui);
  }

  function fallbackText(): string {
    if (toolCall.status === "running" || toolCall.status === "requested") {
      switch (view.action) {
        case "search_spaces":
          return "Searching Confluence spaces…";
        case "search_pages":
          return "Searching Confluence pages…";
        case "get_page":
          return "Fetching Confluence page…";
        case "download_pages":
          return "Downloading Confluence pages…";
        case "create_page":
          return "Creating Confluence page…";
        case "update_page":
          return "Updating Confluence page…";
        case "publish_pages":
          return "Publishing Confluence pages…";
        case "upload_attachment":
          return "Uploading Confluence attachment…";
      }
    }
    return "No Confluence summary available. Open Details for raw arguments and result.";
  }

  const hasBody = $derived.by(() =>
    Boolean(
      bannerText ||
        view.pages.length > 0 ||
        view.page ||
        view.spaces.length > 0 ||
        view.space ||
        view.attachments.length > 0 ||
        view.attachment ||
        view.outcomes.length > 0 ||
        view.downloadDir ||
        view.manifestPath,
    ),
  );

  type BannerTone = "success" | "info" | "default";
  function bannerTone(): BannerTone {
    return view.dryRun ? "info" : view.action.startsWith("search") ? "default" : "success";
  }

  function bannerIcon(): Component | undefined {
    return view.dryRun ? FlaskConical : view.action.startsWith("search") ? Database : CircleCheck;
  }

  const BannerIcon = $derived(bannerIcon());
</script>

{#snippet banner(text: string)}
  <div class="flex min-w-0 items-center gap-2 rounded-sm border bg-sidebar px-2.5 py-2">
    {#if BannerIcon}
      <BannerIcon
        size={14}
        strokeWidth={2}
        class={`shrink-0 ${bannerTone() === "success" ? "text-success" : bannerTone() === "info" ? "text-info" : "text-muted-foreground"}`}
      />
    {/if}
    <span class="min-w-0 break-words text-xs leading-normal text-sidebar-foreground">{text}</span>
  </div>
{/snippet}

{#snippet pageCard(page: NonNullable<ConfluenceView["page"]>)}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2">
    <div class="flex min-w-0 items-start gap-2">
      <FileText size={14} strokeWidth={2} class="mt-0.5 shrink-0 text-info" />
      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span class="font-mono text-xs font-semibold text-sidebar-foreground">{page.id}</span>
          {#if page.status}
            <span class="rounded-sm border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{page.status}</span>
          {/if}
          {#if page.versionNumber !== undefined}
            <span class="rounded-sm border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">v{page.versionNumber}</span>
          {/if}
        </div>
        {#if page.title}
          <div class="break-words text-sm font-medium text-sidebar-foreground">{page.title}</div>
        {/if}
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {#if page.spaceKey}<span>Space {page.spaceKey}</span>{/if}
          {#if page.parentId}<span>Parent <code>{page.parentId}</code></span>{/if}
          {#if page.storagePath}<span>Body <code>{page.storagePath}</code></span>{/if}
          {#if page.markdownPath}<span>Markdown <code>{page.markdownPath}</code></span>{/if}
        </div>
        {#if fullUrl(page.webui)}
          <a class="text-xs text-info underline-offset-2 hover:underline" href={fullUrl(page.webui)} target="_blank" rel="noreferrer">Open in Confluence</a>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet spaceCard(space: NonNullable<ConfluenceView["space"]>)}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2">
    <div class="flex min-w-0 items-start gap-2">
      <Database size={14} strokeWidth={2} class="mt-0.5 shrink-0 text-info" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5">
          {#if space.key}<span class="font-mono text-xs font-semibold text-sidebar-foreground">{space.key}</span>{/if}
          <span class="font-mono text-xs text-muted-foreground">{space.id}</span>
          {#if space.status}<span class="rounded-sm border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{space.status}</span>{/if}
        </div>
        {#if space.name}<div class="mt-1 text-sm font-medium text-sidebar-foreground">{space.name}</div>{/if}
        {#if space.type}<div class="mt-1 text-xs text-muted-foreground">{space.type}</div>{/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet attachmentRow(attachment: NonNullable<ConfluenceView["attachment"]>)}
  <div class="flex min-w-0 items-center gap-2 rounded-sm border bg-sidebar px-2.5 py-2">
    <Paperclip size={14} strokeWidth={2} class="shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium text-sidebar-foreground">{attachment.filename ?? attachment.title ?? attachment.id ?? "attachment"}</div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {#if attachment.mediaType}<span>{attachment.mediaType}</span>{/if}
        {#if confluenceBytesLabel(attachment.fileSize)}<span>{confluenceBytesLabel(attachment.fileSize)}</span>{/if}
        {#if attachment.versionNumber !== undefined}<span>v{attachment.versionNumber}</span>{/if}
        {#if attachment.path}<code>{attachment.path}</code>{/if}
      </div>
      {#if attachment.snippet}<code class="mt-1 block break-all text-xs text-muted-foreground">{attachment.snippet}</code>{/if}
    </div>
  </div>
{/snippet}

{#if hasBody}
  <div class="grid gap-2">
    {#if bannerText}
      {@render banner(bannerText)}
    {/if}

    {#if view.downloadDir || view.manifestPath || view.pagesJsonlPath}
      <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-muted-foreground">
        {#if view.downloadDir}<div>Bundle: <code>{view.downloadDir}</code></div>{/if}
        {#if view.manifestPath}<div>Manifest: <code>{view.manifestPath}</code></div>{/if}
        {#if view.pagesJsonlPath}<div>Pages JSONL: <code>{view.pagesJsonlPath}</code></div>{/if}
      </div>
    {/if}

    {#if view.action === "search_spaces"}
      {#each cap(view.spaces) as space (space.id)}
        {@render spaceCard(space)}
      {/each}
    {:else if view.action === "publish_pages"}
      {#each cap(view.outcomes) as outcome, index (`${outcome.index ?? index}-${outcome.id ?? outcome.title ?? index}`)}
        <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-medium text-sidebar-foreground">{outcome.status ?? outcome.operation ?? "row"}</span>
            {#if outcome.id}<code>{outcome.id}</code>{/if}
            {#if outcome.title}<span class="text-muted-foreground">{outcome.title}</span>{/if}
          </div>
          {#if outcome.message}<div class="mt-1 text-muted-foreground">{outcome.message}</div>{/if}
        </div>
      {/each}
    {:else if view.action === "upload_attachment"}
      {#each cap(view.attachments.length > 0 ? view.attachments : view.attachment ? [view.attachment] : []) as attachment (attachment.id ?? attachment.fileId ?? attachment.filename)}
        {@render attachmentRow(attachment)}
      {/each}
    {:else}
      {#each cap(view.pages.length > 0 ? view.pages : view.page ? [view.page] : []) as page (page.id)}
        {@render pageCard(page)}
      {/each}
      {#if view.attachments.length > 0}
        <span class="text-xs font-medium text-muted-foreground">Attachments</span>
        {#each cap(view.attachments) as attachment (attachment.id ?? attachment.fileId ?? attachment.filename)}
          {@render attachmentRow(attachment)}
        {/each}
      {/if}
    {/if}
  </div>
{:else}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-muted-foreground">
    {fallbackText()}
  </div>
{/if}
