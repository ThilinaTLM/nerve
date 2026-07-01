<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Database from "@lucide/svelte/icons/database";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import type { Component } from "svelte";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import { COLLAPSED_LINES } from "$lib/features/tools/views/tool-result-view";
  import ConfluenceAttachmentRow from "./ConfluenceAttachmentRow.svelte";
  import ConfluenceMetricStrip from "./ConfluenceMetricStrip.svelte";
  import ConfluenceOutcomeRow from "./ConfluenceOutcomeRow.svelte";
  import ConfluencePageRow from "./ConfluencePageRow.svelte";
  import ConfluenceSpaceRow from "./ConfluenceSpaceRow.svelte";

  type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: ConfluenceView;
    expanded?: boolean;
    onOpenFile?: (path: string, line?: number) => void;
  };
  let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

  const ITEM_LIMIT = COLLAPSED_LINES;
  const siteUrl = $derived(settingsState.settingsDraft?.tools?.confluence?.siteUrl);
  const bannerText = $derived(view.messageLines[0]);

  function cap<T>(items: T[]): T[] {
    return expanded ? items : items.slice(0, ITEM_LIMIT);
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
        view.includedCounts,
    ),
  );

  // Keep a banner only where it adds information beyond the structured cards:
  // dry-run previews and the publish summary. Success banners for
  // get/create/update/upload duplicate the header + status icon and are dropped.
  const showBanner = $derived(
    Boolean(bannerText) && (view.dryRun || view.action === "publish_pages"),
  );

  type BannerTone = "success" | "info" | "default";
  function bannerTone(): BannerTone {
    return view.dryRun ? "info" : view.action.startsWith("search") ? "default" : "success";
  }

  function bannerIcon(): Component | undefined {
    return view.dryRun ? FlaskConical : view.action.startsWith("search") ? Database : CircleCheck;
  }

  const BannerIcon = $derived(bannerIcon());

  const pages = $derived(view.pages.length > 0 ? view.pages : view.page ? [view.page] : []);
  const attachments = $derived(
    view.attachments.length > 0 ? view.attachments : view.attachment ? [view.attachment] : [],
  );
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

{#if hasBody}
  <div class="grid gap-2">
    {#if showBanner && bannerText}
      {@render banner(bannerText)}
    {/if}

    {#if view.action === "search_spaces"}
      {#each cap(view.spaces) as space (space.id)}
        <ConfluenceSpaceRow {space} />
      {/each}
    {:else if view.action === "publish_pages"}
      {#each cap(view.outcomes) as outcome, index (`${outcome.index ?? index}-${outcome.id ?? outcome.title ?? index}`)}
        <ConfluenceOutcomeRow {outcome} {expanded} />
      {/each}
    {:else if view.action === "upload_attachment"}
      {#each cap(attachments) as attachment (attachment.id ?? attachment.fileId ?? attachment.filename)}
        <ConfluenceAttachmentRow {attachment} {expanded} {onOpenFile} />
      {/each}
    {:else}
      {#each cap(pages) as page (page.id)}
        <ConfluencePageRow {page} {siteUrl} {expanded} {onOpenFile} />
      {/each}
      {#if view.action === "get_page" && view.includedCounts}
        <ConfluenceMetricStrip counts={view.includedCounts} />
      {/if}
      {#if view.attachments.length > 0}
        <span class="text-xs font-medium text-muted-foreground">Attachments</span>
        {#each cap(view.attachments) as attachment (attachment.id ?? attachment.fileId ?? attachment.filename)}
          <ConfluenceAttachmentRow {attachment} {expanded} {onOpenFile} />
        {/each}
      {/if}
    {/if}
  </div>
{:else}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-muted-foreground">
    {fallbackText()}
  </div>
{/if}
