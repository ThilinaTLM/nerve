import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts";
import {
  type ArgSource,
  type AtlassianSummaryOptions,
  addIncludedCounts,
  addLine,
  addListLine,
  addTextBlock,
  appendArtifactLines,
  appendConfluenceBodySource,
  appendConfluencePagePaths,
  appendList,
  appendMutationOptions,
  appendPayloadSummary,
  appendPreviewHint,
  appendSavePreference,
  compactLines,
  countLabel,
  draftArgSource,
  enabledFlags,
  formatConfluenceAttachment,
  formatConfluenceOutcome,
  formatConfluencePage,
  formatConfluenceSpace,
  outcomeStatusSummary,
  type SummaryBudget,
  sourceBoolean,
  sourceNumber,
  sourceString,
  sourceStringArray,
  stageTitle,
  stringField,
  summaryBudget,
  toolArgSource,
  toolResultDetails,
  yesNo,
} from "./atlassian-summary-common";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import type { ToolView } from "./tool-view-types";

type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;
type ConfluenceAction = ConfluenceView["action"];

const CONFLUENCE_ACTION_LABELS: Record<ConfluenceAction, string> = {
  search_spaces: "search spaces",
  search_pages: "search pages",
  get_page: "get page",
  download_pages: "download pages",
  create_page: "create page",
  update_page: "update page",
  publish_pages: "publish pages",
  upload_attachment: "upload attachment",
};

const CONFLUENCE_INCLUDED_LABELS: Record<string, string> = {
  pages: "pages",
  spaces: "spaces",
  labels: "labels",
  properties: "properties",
  operations: "operations",
  versions: "versions",
  directChildren: "direct children",
  attachments: "attachments",
  downloadedAttachments: "downloaded attachments",
};

export function isConfluenceToolName(toolName: string | undefined): boolean {
  return Boolean(toolName?.startsWith("confluence_"));
}

export function confluenceToolSummaryBody(
  toolCall: ToolCallDisplayRecord,
  view: ConfluenceView,
  options: AtlassianSummaryOptions = {},
): string {
  const budget = summaryBudget(options);
  const source = toolArgSource(toolCall);
  const details = toolResultDetails(toolCall);
  const lines = [
    stageTitle(
      "Confluence",
      CONFLUENCE_ACTION_LABELS[view.action],
      toolCall.status,
      view.dryRun,
    ),
  ];

  appendConfluenceRequestLines(lines, view.action, source, view, budget);
  appendConfluenceOutcomeLines(lines, view, details, budget);
  appendArtifactLines(lines, view, budget);
  appendPreviewHint(lines, toolCall, options);

  return compactLines(lines).join("\n");
}

export function confluenceDraftSummaryBody(
  draft: ConversationLiveToolDraftBlockSnapshot,
  options: AtlassianSummaryOptions = {},
): string | undefined {
  const action = confluenceActionFromToolName(draft.toolName);
  if (!action) return undefined;
  const budget = summaryBudget(options);
  const source = draftArgSource(draft);
  const lines = [
    `${draft.done ? "Prepared" : "Preparing"} Confluence ${CONFLUENCE_ACTION_LABELS[action]}`,
  ];
  appendConfluenceRequestLines(lines, action, source, undefined, budget);
  if (lines.length === 1) lines.push("Waiting for arguments…");
  return compactLines(lines).join("\n");
}

function appendConfluenceRequestLines(
  lines: string[],
  action: ConfluenceAction,
  source: ArgSource,
  view: ConfluenceView | undefined,
  budget: SummaryBudget,
): void {
  switch (action) {
    case "search_spaces": {
      addLine(lines, "Query", view?.query ?? sourceString(source, "query"));
      addListLine(lines, "Keys", sourceStringArray(source, "keys"), budget);
      addListLine(lines, "Ids", sourceStringArray(source, "ids"), budget);
      addLine(lines, "Limit", sourceNumber(source, "limit"));
      addLine(lines, "Cursor", sourceString(source, "cursor"));
      appendSavePreference(lines, source);
      break;
    }
    case "search_pages": {
      addTextBlock(
        lines,
        "CQL",
        view?.cql ?? sourceString(source, "cql"),
        budget,
      );
      addLine(lines, "Query", view?.query ?? sourceString(source, "query"));
      addLine(
        lines,
        "Space",
        view?.spaceKey ??
          sourceString(source, "space_key") ??
          view?.spaceId ??
          sourceString(source, "space_id"),
      );
      addLine(lines, "Title", view?.title ?? sourceString(source, "title"));
      addLine(lines, "Status", view?.status ?? sourceString(source, "status"));
      addLine(
        lines,
        "Body format",
        view?.bodyFormat ?? sourceString(source, "body_format"),
      );
      addLine(lines, "Limit", sourceNumber(source, "limit"));
      addLine(lines, "Cursor", sourceString(source, "cursor"));
      appendSavePreference(lines, source);
      break;
    }
    case "get_page": {
      addLine(lines, "Page", view?.pageId ?? sourceString(source, "page_id"));
      addLine(
        lines,
        "Body format",
        view?.bodyFormat ?? sourceString(source, "body_format"),
      );
      addListLine(
        lines,
        "Includes",
        enabledFlags(source, {
          include_labels: "labels",
          include_properties: "properties",
          include_operations: "operations",
          include_versions: "versions",
          include_version: "version metadata",
          include_direct_children: "direct children",
          include_attachments: "attachments",
          markdown: "markdown sidecar",
        }),
        budget,
      );
      appendSavePreference(lines, source);
      break;
    }
    case "download_pages": {
      addLine(
        lines,
        "Root page",
        view?.pageId ?? sourceString(source, "page_id"),
      );
      addLine(
        lines,
        "Space",
        view?.spaceKey ??
          sourceString(source, "space_key") ??
          view?.spaceId ??
          sourceString(source, "space_id"),
      );
      addTextBlock(
        lines,
        "CQL",
        view?.cql ?? sourceString(source, "cql"),
        budget,
      );
      addLine(lines, "Recurse", yesNo(sourceBoolean(source, "recurse")));
      addLine(lines, "Depth", sourceNumber(source, "depth"));
      addLine(lines, "Limit", sourceNumber(source, "limit"));
      addLine(
        lines,
        "Body format",
        view?.bodyFormat ?? sourceString(source, "body_format"),
      );
      addListLine(
        lines,
        "Outputs",
        enabledFlags(source, {
          markdown: "markdown sidecars",
          include_attachments: "attachment metadata",
          download_attachments: "download attachments",
        }),
        budget,
      );
      appendSavePreference(lines, source);
      break;
    }
    case "create_page": {
      addLine(
        lines,
        "Space",
        view?.spaceKey ??
          sourceString(source, "space_key") ??
          view?.spaceId ??
          sourceString(source, "space_id") ??
          "default space",
      );
      addLine(lines, "Title", view?.title ?? sourceString(source, "title"));
      addLine(lines, "Parent", sourceString(source, "parent_id"));
      addLine(lines, "Status", view?.status ?? sourceString(source, "status"));
      appendConfluenceBodySource(lines, source, budget);
      addLine(
        lines,
        "Representation",
        sourceString(source, "body_representation"),
      );
      appendMutationOptions(lines, source, "create page", view?.dryRun);
      addLine(
        lines,
        "Return page",
        yesNo(sourceBoolean(source, "return_page")),
      );
      appendSavePreference(lines, source);
      break;
    }
    case "update_page": {
      addLine(
        lines,
        "Page",
        view?.pageId ??
          sourceString(source, "page_id") ??
          sourceString(source, "page_file"),
      );
      addLine(lines, "Title", view?.title ?? sourceString(source, "title"));
      addLine(lines, "Parent", sourceString(source, "parent_id"));
      addLine(lines, "Status", view?.status ?? sourceString(source, "status"));
      appendConfluenceBodySource(lines, source, budget);
      addLine(
        lines,
        "Representation",
        sourceString(source, "body_representation"),
      );
      addTextBlock(
        lines,
        "Version message",
        sourceString(source, "version_message"),
        budget,
      );
      addLine(
        lines,
        "Allow stale",
        yesNo(sourceBoolean(source, "allow_stale")),
      );
      appendMutationOptions(lines, source, "update page", view?.dryRun);
      addLine(
        lines,
        "Return page",
        yesNo(sourceBoolean(source, "return_page")),
      );
      appendSavePreference(lines, source);
      break;
    }
    case "publish_pages": {
      addLine(
        lines,
        "Input",
        view?.inputPath ?? sourceString(source, "input_path"),
      );
      addLine(
        lines,
        "Create missing",
        yesNo(sourceBoolean(source, "create_missing")),
      );
      addLine(
        lines,
        "Allow stale",
        yesNo(sourceBoolean(source, "allow_stale")),
      );
      addTextBlock(
        lines,
        "Version message",
        sourceString(source, "version_message"),
        budget,
      );
      addLine(lines, "Limit", sourceNumber(source, "limit"));
      appendMutationOptions(lines, source, "publish pages", view?.dryRun);
      appendSavePreference(lines, source);
      break;
    }
    case "upload_attachment": {
      addLine(lines, "Page", view?.pageId ?? sourceString(source, "page_id"));
      addLine(lines, "File", sourceString(source, "file_path"));
      addLine(
        lines,
        "Filename",
        view?.attachment?.filename ?? sourceString(source, "filename"),
      );
      addTextBlock(lines, "Comment", sourceString(source, "comment"), budget);
      addLine(lines, "Minor edit", yesNo(sourceBoolean(source, "minor_edit")));
      addLine(
        lines,
        "Update existing",
        yesNo(sourceBoolean(source, "update_existing")),
      );
      addLine(lines, "Status", view?.status ?? sourceString(source, "status"));
      appendSavePreference(lines, source);
      break;
    }
  }
}

function appendConfluenceOutcomeLines(
  lines: string[],
  view: ConfluenceView,
  details: Record<string, unknown>,
  budget: SummaryBudget,
): void {
  if (!hasConfluenceOutcome(view)) return;

  switch (view.action) {
    case "search_spaces": {
      addLine(
        lines,
        "Returned",
        countLabel(view.spaceCount ?? view.spaces.length, "space"),
      );
      addLine(
        lines,
        "Next cursor",
        view.nextCursor ?? stringField(details.nextCursor),
      );
      appendList(
        lines,
        "Spaces",
        view.spaces.map(formatConfluenceSpace),
        budget,
      );
      break;
    }
    case "search_pages": {
      addLine(
        lines,
        "Returned",
        countLabel(view.pageCount ?? view.pages.length, "page"),
      );
      addLine(
        lines,
        "Next cursor",
        view.nextCursor ?? stringField(details.nextCursor),
      );
      appendList(lines, "Pages", view.pages.map(formatConfluencePage), budget);
      break;
    }
    case "get_page": {
      if (view.page) addLine(lines, "Fetched", formatConfluencePage(view.page));
      addIncludedCounts(
        lines,
        view.includedCounts,
        CONFLUENCE_INCLUDED_LABELS,
        "Included",
      );
      appendConfluencePagePaths(lines, view.page);
      appendList(
        lines,
        "Attachments",
        view.attachments.map(formatConfluenceAttachment),
        budget,
      );
      break;
    }
    case "download_pages": {
      addLine(lines, "Bundle", view.downloadDir);
      addLine(lines, "Manifest", view.manifestPath);
      addLine(lines, "Pages JSONL", view.pagesJsonlPath);
      addLine(
        lines,
        "Downloaded",
        countLabel(view.pageCount ?? view.pages.length, "page"),
      );
      addIncludedCounts(
        lines,
        view.includedCounts,
        CONFLUENCE_INCLUDED_LABELS,
        "Included",
      );
      appendList(lines, "Pages", view.pages.map(formatConfluencePage), budget);
      break;
    }
    case "create_page": {
      addLine(lines, view.dryRun ? "Would create" : "Created", view.pageId);
      if (view.page) addLine(lines, "Page", formatConfluencePage(view.page));
      appendPayloadSummary(lines, view.payload ?? details.payload, budget);
      break;
    }
    case "update_page": {
      addLine(lines, view.dryRun ? "Would update" : "Updated", view.pageId);
      if (view.page) addLine(lines, "Page", formatConfluencePage(view.page));
      appendPayloadSummary(lines, view.payload ?? details.payload, budget);
      break;
    }
    case "publish_pages": {
      addLine(
        lines,
        "Processed",
        countLabel(view.outcomeCount ?? view.outcomes.length, "outcome"),
      );
      addLine(lines, "Outcome statuses", outcomeStatusSummary(view.outcomes));
      appendList(
        lines,
        "Outcomes",
        view.outcomes.map(formatConfluenceOutcome),
        budget,
      );
      break;
    }
    case "upload_attachment": {
      addLine(lines, "Page", view.pageId);
      const attachment = view.attachment ?? view.attachments[0];
      if (attachment)
        addLine(lines, "Attachment", formatConfluenceAttachment(attachment));
      if (attachment?.snippet)
        addTextBlock(lines, "Storage snippet", attachment.snippet, budget);
      break;
    }
  }
}

function confluenceActionFromToolName(
  toolName: string | undefined,
): ConfluenceAction | undefined {
  switch (toolName) {
    case "confluence_search_spaces":
      return "search_spaces";
    case "confluence_search_pages":
      return "search_pages";
    case "confluence_get_page":
      return "get_page";
    case "confluence_download_pages":
      return "download_pages";
    case "confluence_create_page":
      return "create_page";
    case "confluence_update_page":
      return "update_page";
    case "confluence_publish_pages":
      return "publish_pages";
    case "confluence_upload_attachment":
      return "upload_attachment";
    default:
      return undefined;
  }
}

function hasConfluenceOutcome(view: ConfluenceView): boolean {
  return Boolean(
    view.messageLines.length > 0 ||
    view.pages.length > 0 ||
    view.page ||
    view.spaces.length > 0 ||
    view.space ||
    view.attachments.length > 0 ||
    view.attachment ||
    view.outcomes.length > 0 ||
    view.downloadDir ||
    view.dryRun,
  );
}
