import {
  confluenceAttachmentSummarySchema,
  confluenceCommentSummarySchema,
  confluenceLabelSummarySchema,
  confluencePageSummarySchema,
  confluencePublishOutcomeSchema,
  confluenceRestrictionSummarySchema,
  confluenceResultDetailsSchema,
  confluenceSpaceSummarySchema,
} from "@nervekit/contracts/tools";
import type { ConversationLiveToolOutputSnapshot } from "@nervekit/contracts/conversations";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import {
  asRecord,
  outputArtifactsFromDetails,
  outputLimitsFromDetails,
  parseToolExecutionResult,
  resultOutputText,
  stringField,
} from "./tool-view-helpers";
import type { ToolView } from "./tool-view-types";

const CONFLUENCE_DISPLAY_ITEM_LIMIT = 20;

type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;
type ConfluenceToolAction = ConfluenceView["action"];

export function parseConfluenceView(
  toolCall: ToolCallDisplayRecord,
  args: Record<string, unknown>,
  rawResult: unknown,
  liveOutput?: ConversationLiveToolOutputSnapshot,
): ToolView {
  const action = confluenceAction(toolCall.toolName);
  if (!action)
    return {
      kind: "generic",
      toolName: toolCall.toolName,
      args: [],
      result: [],
    };
  const result = parseToolExecutionResult(rawResult);
  const outputLimits = outputLimitsFromDetails(result?.details);
  const outputArtifacts = outputArtifactsFromDetails(result?.details);
  const parsedDetails = confluenceResultDetailsSchema.safeParse(
    result?.details,
  );
  const details = parsedDetails.success
    ? (parsedDetails.data as Record<string, unknown>)
    : (asRecord(result?.details) ?? {});
  const content = resultOutputText(result, rawResult, liveOutput);
  const spaces = confluenceArray(details.spaces, (item) =>
    confluenceSpaceSummarySchema.parse(item),
  );
  const pages = confluenceArray(details.pages, (item) =>
    confluencePageSummarySchema.parse(item),
  );
  const attachments = confluenceArray(details.attachments, (item) =>
    confluenceAttachmentSummarySchema.parse(item),
  );
  const outcomes = confluenceArray(details.outcomes, (item) =>
    confluencePublishOutcomeSchema.parse(item),
  );
  const page = confluencePageSummarySchema.safeParse(details.page);
  const space = confluenceSpaceSummarySchema.safeParse(details.space);
  const attachment = confluenceAttachmentSummarySchema.safeParse(
    details.attachment,
  );
  return {
    kind: "confluence",
    action,
    toolName: toolCall.toolName,
    content,
    contentLineCount:
      outputLimits?.model?.displayedLines ?? countLines(content),
    messageLines: confluenceMessageLines(content),
    query: stringField(details.query) ?? stringField(args.query),
    cql: stringField(details.cql) ?? stringField(args.cql),
    pageId:
      stringField(details.pageId) ??
      (page.success ? page.data.id : undefined) ??
      stringField(args.page_id),
    spaceId:
      stringField(details.spaceId) ??
      (space.success ? space.data.id : undefined) ??
      stringField(args.space_id),
    spaceKey:
      stringField(details.spaceKey) ??
      (space.success ? space.data.key : undefined) ??
      stringField(args.space_key),
    title:
      stringField(details.title) ??
      (page.success ? page.data.title : undefined) ??
      stringField(args.title),
    status: stringField(details.status) ?? stringField(args.status),
    bodyFormat:
      stringField(details.bodyFormat) ?? stringField(args.body_format),
    spaces: spaces.slice(0, CONFLUENCE_DISPLAY_ITEM_LIMIT),
    space: space.success ? space.data : spaces[0],
    spaceCount:
      numberField(details.spaceCount) ??
      (spaces.length > 0 ? spaces.length : undefined),
    displayedSpaceCount:
      numberField(details.displayedSpaceCount) ??
      (spaces.length > 0
        ? Math.min(spaces.length, CONFLUENCE_DISPLAY_ITEM_LIMIT)
        : undefined),
    pages: pages.slice(0, CONFLUENCE_DISPLAY_ITEM_LIMIT),
    page: page.success ? page.data : pages[0],
    pageCount:
      numberField(details.pageCount) ??
      (pages.length > 0 ? pages.length : undefined),
    displayedPageCount:
      numberField(details.displayedPageCount) ??
      (pages.length > 0
        ? Math.min(pages.length, CONFLUENCE_DISPLAY_ITEM_LIMIT)
        : undefined),
    attachments: attachments.slice(0, CONFLUENCE_DISPLAY_ITEM_LIMIT),
    attachment: attachment.success ? attachment.data : attachments[0],
    attachmentCount:
      numberField(details.attachmentCount) ??
      (attachments.length > 0 ? attachments.length : undefined),
    displayedAttachmentCount:
      numberField(details.displayedAttachmentCount) ??
      (attachments.length > 0
        ? Math.min(attachments.length, CONFLUENCE_DISPLAY_ITEM_LIMIT)
        : undefined),
    includedCounts: parsedDetails.success
      ? parsedDetails.data.includedCounts
      : undefined,
    downloadDir: stringField(details.downloadDir),
    manifestPath: stringField(details.manifestPath),
    pagesJsonlPath: stringField(details.pagesJsonlPath),
    inputPath: stringField(details.inputPath) ?? stringField(args.input_path),
    nextCursor: stringField(details.nextCursor),
    outcomes: outcomes.slice(0, CONFLUENCE_DISPLAY_ITEM_LIMIT),
    outcomeCount:
      numberField(details.outcomeCount) ??
      (outcomes.length > 0 ? outcomes.length : undefined),
    displayedOutcomeCount:
      numberField(details.displayedOutcomeCount) ??
      (outcomes.length > 0
        ? Math.min(outcomes.length, CONFLUENCE_DISPLAY_ITEM_LIMIT)
        : undefined),
    operation:
      stringField(details.operation) ??
      (action.startsWith("manage_") ? stringField(details.action) : undefined),
    commentId: stringField(details.commentId) ?? stringField(args.comment_id),
    comment: parseOptional(confluenceCommentSummarySchema, details.comment),
    commentKind:
      details.kind === "footer" || details.kind === "inline"
        ? details.kind
        : args.kind === "footer" || args.kind === "inline"
          ? args.kind
          : undefined,
    label: stringField(details.label) ?? stringField(args.label),
    labels: confluenceArray(details.labels, (item) =>
      confluenceLabelSummarySchema.parse(
        typeof item === "string" ? { name: item } : item,
      ),
    ),
    labelCount: numberField(details.labelCount),
    prefix: stringField(details.prefix) ?? stringField(args.prefix),
    restrictionOperation:
      details.restrictionOperation === "read" ||
      details.restrictionOperation === "update"
        ? details.restrictionOperation
        : args.operation === "read" || args.operation === "update"
          ? args.operation
          : undefined,
    subjectType:
      details.subjectType === "user" || details.subjectType === "group"
        ? details.subjectType
        : args.subject_type === "user" || args.subject_type === "group"
          ? args.subject_type
          : undefined,
    subjectId: stringField(details.subjectId) ?? stringField(args.subject_id),
    restrictions: confluenceArray(details.restrictions, (item) =>
      confluenceRestrictionSummarySchema.parse(item),
    ),
    restrictionCount: numberField(details.restrictionCount),
    previousStatus: stringField(details.previousStatus),
    resultingStatus: stringField(details.resultingStatus),
    attachmentId:
      stringField(details.attachmentId) ?? stringField(args.attachment_id),
    filename:
      stringField(details.filename) ??
      stringField(details.newFilename) ??
      stringField(args.filename) ??
      stringField(args.new_filename) ??
      fileBasename(stringField(args.file_path)),
    newFilename:
      stringField(details.newFilename) ?? stringField(args.new_filename),
    bytes: numberField(details.bytes),
    dryRun: typeof details.dryRun === "boolean" ? details.dryRun : undefined,
    payload: details.payload,
    outputLimits,
    outputArtifacts,
  };
}

function confluenceAction(toolName: string): ConfluenceToolAction | undefined {
  switch (toolName) {
    case "confluence_search_spaces":
      return "search_spaces";
    case "confluence_search_pages":
      return "search_pages";
    case "confluence_get_page":
      return "get_page";
    case "confluence_download_page":
      return "download_page";
    case "confluence_create_page":
      return "create_page";
    case "confluence_update_page":
      return "update_page";
    case "confluence_manage_comment":
      return "manage_comment";
    case "confluence_manage_page":
      return "manage_page";
    case "confluence_manage_label":
      return "manage_label";
    case "confluence_manage_restriction":
      return "manage_restriction";
    case "confluence_manage_attachment":
      return "manage_attachment";
    default:
      return undefined;
  }
}

function parseOptional<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  value: unknown,
): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function fileBasename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.replaceAll("\\", "/").split("/").at(-1) || undefined;
}

function confluenceArray<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    try {
      return [parse(item)];
    } catch {
      return [];
    }
  });
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.length === 0 ? 0 : text.split("\n").length;
}

function confluenceMessageLines(content: string | undefined): string[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("- "))
    .slice(0, 8);
}
