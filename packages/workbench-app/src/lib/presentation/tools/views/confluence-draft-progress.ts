import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts/conversations";
import type { DraftMetaItem } from "./tool-draft-progress";

type FirstKnownString = (
  draft: ConversationLiveToolDraftBlockSnapshot,
  property: string,
) => string | undefined;

export function confluenceDraftPrimaryArg(
  draft: ConversationLiveToolDraftBlockSnapshot,
  firstKnownString: FirstKnownString,
): string | undefined {
  const toolName = draft.toolName;
  if (toolName === "confluence_search_spaces") {
    return firstKnownString(draft, "query") ?? firstKnownString(draft, "keys");
  }
  if (toolName === "confluence_search_pages") {
    return (
      firstKnownString(draft, "cql") ??
      firstKnownString(draft, "query") ??
      firstKnownString(draft, "title")
    );
  }
  if (toolName === "confluence_download_page") {
    return firstKnownString(draft, "page_id");
  }
  if (toolName === "confluence_create_page") {
    return (
      firstKnownString(draft, "title") ?? firstKnownString(draft, "page_file")
    );
  }
  if (toolName === "confluence_manage_attachment") {
    return (
      firstKnownString(draft, "file_path") ?? firstKnownString(draft, "page_id")
    );
  }
  if (
    toolName === "confluence_get_page" ||
    toolName === "confluence_update_page" ||
    toolName === "confluence_manage_comment" ||
    toolName === "confluence_manage_page" ||
    toolName === "confluence_manage_label" ||
    toolName === "confluence_manage_restriction"
  ) {
    return (
      firstKnownString(draft, "page_id") ?? firstKnownString(draft, "page_file")
    );
  }
  return undefined;
}

export function confluenceDraftMeta(
  draft: ConversationLiveToolDraftBlockSnapshot,
  firstKnownString: FirstKnownString,
): DraftMetaItem[] {
  const toolName = draft.toolName;
  const args = asRecord(draft.args);
  const meta: DraftMetaItem[] = [];
  const limit = numberField(args.limit);
  if (limit !== undefined) meta.push({ text: `max ${limit}` });
  const spaceKey = firstKnownString(draft, "space_key");
  if (spaceKey) meta.push({ text: `space ${spaceKey}`, mono: true });
  if (args.markdown === true) meta.push({ text: "markdown" });
  if (toolName === "confluence_get_page" && Array.isArray(args.include)) {
    for (const value of args.include) {
      if (typeof value === "string")
        meta.push({ text: value.replaceAll("_", " ") });
    }
  }
  if (toolName === "confluence_download_page") {
    if (args.attachments === "metadata") meta.push({ text: "attachments" });
    if (args.attachments === "download") meta.push({ text: "download files" });
  }
  if (args.recurse === true) meta.push({ text: "subtree" });
  if (args.dry_run === true) meta.push({ text: "dry run", tone: "info" });
  if (toolName === "confluence_update_page" && args.allow_stale === true) {
    meta.push({ text: "allow stale", tone: "warning" });
  }
  if (toolName === "confluence_manage_attachment") {
    const pageId = firstKnownString(draft, "page_id");
    if (pageId) meta.push({ text: `page ${pageId}`, mono: true });
    if (args.update_existing === false) meta.push({ text: "new only" });
  }
  return meta;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
