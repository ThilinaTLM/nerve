<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import FlaskConical from "@lucide/svelte/icons/flask-conical";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import { getConversationUiCapabilities } from "../../../context.svelte";
import { confluenceToolSummaryBody } from "../../views/atlassian-tool-summary";
import {
  confluenceBanner,
  confluenceEmptyMessage,
  hasStructuredConfluence,
} from "../../views/atlassian-view-body";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { ATLASSIAN_COLLAPSED_ITEMS } from "../../views/tool-result-view";
import AtlassianBanner from "./AtlassianBanner.svelte";
import ConfluenceAttachmentRow from "./ConfluenceAttachmentRow.svelte";
import ConfluenceMetricStrip from "./ConfluenceMetricStrip.svelte";
import ConfluenceOutcomeRow from "./ConfluenceOutcomeRow.svelte";
import ConfluencePageRow from "./ConfluencePageRow.svelte";
import ConfluenceSpaceRow from "./ConfluenceSpaceRow.svelte";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: ConfluenceView;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

const capabilities = getConversationUiCapabilities();
const siteUrl = $derived(capabilities.atlassian?.confluenceSiteUrl());
const limit = $derived(
  expanded ? Number.POSITIVE_INFINITY : ATLASSIAN_COLLAPSED_ITEMS,
);
const banner = $derived(confluenceBanner(view, toolCall.status));
const emptyMessage = $derived(confluenceEmptyMessage(view, toolCall.status));
const structured = $derived(hasStructuredConfluence(view, toolCall.status));
const fallbackSummary = $derived(
  structured
    ? undefined
    : confluenceToolSummaryBody(toolCall, view, { expanded }),
);
const metricCounts = $derived.by(() => {
  if (!view.includedCounts) return undefined;
  const counts = { ...view.includedCounts };
  delete counts.attachments;
  delete counts.downloadedAttachments;
  return Object.keys(counts).length > 0 ? counts : undefined;
});
const downloadPaths = $derived(
  view.action === "download_pages"
    ? [
        view.downloadDir,
        ...(expanded ? [view.manifestPath, view.pagesJsonlPath] : []),
      ].filter((path): path is string => Boolean(path))
    : [],
);
</script>

{#snippet pathRow(path: string)}
  {#if onOpenFile}
    <button
      type="button"
      class="flex min-w-0 items-center gap-1.5 rounded-sm border bg-sidebar px-2.5 py-1.5 text-left font-mono text-xs text-sidebar-foreground hover:bg-muted/40"
      onclick={() => onOpenFile?.(path)}
      title={path}
    >
      <FolderOpen
        size={12}
        strokeWidth={2}
        class="shrink-0 text-muted-foreground"
      />
      <span class="truncate">{path}</span>
    </button>
  {:else}
    <span
      class="flex min-w-0 items-center gap-1.5 rounded-sm border bg-sidebar px-2.5 py-1.5 font-mono text-xs text-sidebar-foreground"
      title={path}
    >
      <FolderOpen
        size={12}
        strokeWidth={2}
        class="shrink-0 text-muted-foreground"
      />
      <span class="truncate">{path}</span>
    </span>
  {/if}
{/snippet}

{#if structured}
  <div class="grid gap-1.5">
    {#if banner}
      <AtlassianBanner
        text={banner.text}
        tone={banner.tone}
        icon={banner.tone === "info" ? FlaskConical : CircleCheck}
      />
    {/if}

    {#if view.action === "search_pages"}
      {#each view.pages.slice(0, limit) as page (page.id)}
        <ConfluencePageRow {page} {siteUrl} {expanded} {onOpenFile} />
      {/each}
      {#if view.nextCursor}
        <p class="m-0 text-xs text-muted-foreground">More results available.</p>
      {/if}
    {:else if view.action === "search_spaces"}
      {#each view.spaces.slice(0, limit) as space (space.id)}
        <ConfluenceSpaceRow {space} />
      {/each}
    {:else if view.action === "get_page"}
      {#if view.page}
        <ConfluencePageRow page={view.page} {siteUrl} {expanded} {onOpenFile} />
      {/if}
      {#if metricCounts}
        <ConfluenceMetricStrip counts={metricCounts} />
      {/if}
      <!-- Attachment details/counts are intentionally footer-only. -->
    {:else if view.action === "download_pages"}
      {#each downloadPaths as path (path)}
        {@render pathRow(path)}
      {/each}
      {#each view.pages.slice(0, limit) as page (page.id)}
        <ConfluencePageRow {page} {siteUrl} {expanded} {onOpenFile} />
      {/each}
    {:else if view.action === "create_page" || view.action === "update_page"}
      {#if view.page}
        <ConfluencePageRow page={view.page} {siteUrl} {expanded} {onOpenFile} />
      {/if}
    {:else if view.action === "publish_pages"}
      {#each view.outcomes.slice(0, limit) as outcome, index (outcome.id ?? outcome.index ?? index)}
        <ConfluenceOutcomeRow {outcome} {expanded} />
      {/each}
    {:else if view.action === "upload_attachment"}
      {#if view.attachment}
        <ConfluenceAttachmentRow
          attachment={view.attachment}
          {expanded}
          {onOpenFile}
        />
      {/if}
    {/if}

    {#if emptyMessage}
      <p class="m-0 text-xs text-muted-foreground">{emptyMessage}</p>
    {/if}
  </div>
{:else if fallbackSummary}
  <ToolArgumentBody
    body={{ kind: "atlassian-summary", text: fallbackSummary }}
  />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">
    No Confluence summary available. Open Details for raw arguments and result.
  </p>
{/if}
