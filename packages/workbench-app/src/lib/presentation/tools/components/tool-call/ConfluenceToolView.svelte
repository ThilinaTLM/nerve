<script lang="ts">
import { getConversationUiCapabilities } from "../../../context.svelte";
import { confluenceToolSummaryBody } from "../../views/atlassian-tool-summary";
import { confluencePageUrl } from "../../views/confluence-display";
import { formatBytes } from "../../views/tool-presentation-helpers";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { ATLASSIAN_COLLAPSED_ITEMS } from "../../views/tool-result-view";
import AtlassianOutcomeRow from "./AtlassianOutcomeRow.svelte";
import AtlassianResourceRow from "./AtlassianResourceRow.svelte";
import AtlassianResultSurface from "./AtlassianResultSurface.svelte";
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
const fallbackSummary = $derived(
  confluenceToolSummaryBody(toolCall, view, { expanded }),
);

function joined(...values: Array<string | undefined>): string | undefined {
  const text = values.filter(Boolean).join(" · ");
  return text || undefined;
}
function past(operation: string | undefined): string {
  switch (operation) {
    case "create":
      return "Created";
    case "delete":
      return "Deleted";
    case "resolve":
      return "Resolved";
    case "reopen":
      return "Reopened";
    case "trash":
      return "Moved to trash";
    case "restore":
      return "Restored";
    case "purge":
      return "Permanently purged";
    case "add":
      return "Added";
    case "remove":
      return "Removed";
    case "clear_operation":
      return "Cleared";
    case "upload":
      return "Uploaded";
    case "rename":
      return "Renamed";
    default:
      return "Updated";
  }
}
function outcomeTitle(text: string): string {
  return view.dryRun ? `Would ${text[0]?.toLowerCase()}${text.slice(1)}` : text;
}
function outcomeTone(destructive = false, warning = false) {
  if (view.dryRun) return "info" as const;
  if (destructive) return "destructive" as const;
  if (warning) return "warning" as const;
  return "success" as const;
}
</script>

{#if toolCall.status === "completed"}
  <AtlassianResultSurface>
    {#if view.action === "search_spaces"}
      {#each view.spaces.slice(0, limit) as space (space.id)}
        <ConfluenceSpaceRow {space} />
      {:else}
        <AtlassianOutcomeRow title="No spaces found." />
      {/each}
    {:else if view.action === "search_pages"}
      {#each view.pages.slice(0, limit) as page (page.id)}
        <ConfluencePageRow {page} {siteUrl} {expanded} {onOpenFile} />
      {:else}
        <AtlassianOutcomeRow title="No pages found." />
      {/each}
    {:else if view.action === "get_page"}
      {#if view.page}
        <ConfluencePageRow page={view.page} {siteUrl} {expanded} {onOpenFile} />
      {:else}
        <AtlassianOutcomeRow
          title={view.pageId ? `Fetched page ${view.pageId}` : "Page fetched"}
          detail="Open Details for the complete response."
        />
      {/if}
    {:else if view.action === "download_page"}
      <AtlassianOutcomeRow
        title={`Downloaded ${view.page?.title ?? (view.pageId ? `page ${view.pageId}` : "page")}`}
        detail={joined(
          view.bodyFormat,
          view.includedCounts?.downloadedAttachments !== undefined
            ? `${view.includedCounts.downloadedAttachments} attachments`
            : undefined,
        )}
        tone="success"
      />
      {#if expanded}
        {#each view.pages as page (page.id)}
          <ConfluencePageRow {page} {siteUrl} {expanded} {onOpenFile} />
        {/each}
      {/if}
    {:else if view.action === "create_page"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `Created page “${view.title ?? view.page?.title ?? "Untitled"}”`,
        )}
        detail={joined(
          view.spaceKey ?? view.page?.spaceKey,
          view.page?.versionNumber !== undefined
            ? `v${view.page.versionNumber}`
            : undefined,
          view.status ?? view.page?.status,
        )}
        tone={outcomeTone()}
      />
    {:else if view.action === "update_page"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `Updated page “${view.title ?? view.page?.title ?? view.pageId ?? "page"}”${view.page?.versionNumber !== undefined ? ` to v${view.page.versionNumber}` : ""}`,
        )}
        detail={joined(view.status ?? view.page?.status, view.page?.spaceKey)}
        tone={outcomeTone()}
      />
    {:else if view.action === "manage_comment"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `${past(view.operation)} ${view.commentKind ?? ""} comment${view.commentId ? ` ${view.commentId}` : ""}`.replace(
            /\s+/g,
            " ",
          ),
        )}
        detail={view.comment?.bodyPreview ?? view.comment?.resolutionStatus}
        tone={outcomeTone(view.operation === "delete")}
      />
    {:else if view.action === "manage_page"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.operation === "trash"
            ? `Moved page ${view.pageId ?? ""} to trash`.trim()
            : view.operation === "purge"
              ? `Permanently purged page ${view.pageId ?? ""}`.trim()
              : `Restored page ${view.pageId ?? ""}`.trim(),
        )}
        detail={view.previousStatus && view.resultingStatus
          ? `${view.previousStatus} → ${view.resultingStatus}`
          : undefined}
        tone={outcomeTone(
          view.operation === "purge",
          view.operation === "trash",
        )}
      />
    {:else if view.action === "manage_label"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `${past(view.operation)} label “${view.label ?? "label"}”`,
        )}
        detail={view.labels.length > 0
          ? view.labels
              .slice(0, expanded ? view.labels.length : 3)
              .map((label) => label.name)
              .join(", ")
          : undefined}
        tone={outcomeTone()}
      />
    {:else if view.action === "manage_restriction"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.operation === "clear_operation"
            ? `Cleared ${view.restrictionOperation ?? "page"} restrictions`
            : `${past(view.operation)} ${view.subjectType ?? "subject"} restriction`,
        )}
        detail={joined(view.subjectId, view.restrictionOperation)}
        tone={outcomeTone(view.operation === "clear_operation")}
      />
    {:else if view.action === "manage_attachment"}
      {#if view.attachment && view.operation !== "delete"}
        <AtlassianOutcomeRow
          title={outcomeTitle(
            `${past(view.operation)} ${view.filename ?? view.attachment.filename ?? "attachment"}`,
          )}
          detail={joined(
            view.attachment.mediaType,
            formatBytes(view.attachment.fileSize ?? view.bytes),
            view.attachment.versionNumber !== undefined
              ? `v${view.attachment.versionNumber}`
              : undefined,
          )}
          tone={outcomeTone()}
        />
      {:else}
        <AtlassianOutcomeRow
          title={outcomeTitle(
            `${past(view.operation)} ${view.filename ?? view.attachmentId ?? "attachment"}`,
          )}
          detail={view.pageId ? `Page ${view.pageId}` : undefined}
          tone={outcomeTone(view.operation === "delete")}
        />
      {/if}
    {:else}
      <AtlassianResourceRow
        icon="page"
        id={view.pageId}
        title={view.title ?? "Confluence result"}
        href={view.page
          ? confluencePageUrl(siteUrl, view.page.webui)
          : undefined}
        detail="Open Details for the complete response."
      />
    {/if}
  </AtlassianResultSurface>
{:else if fallbackSummary}
  <ToolArgumentBody
    body={{ kind: "atlassian-summary", text: fallbackSummary }}
  />
{/if}
