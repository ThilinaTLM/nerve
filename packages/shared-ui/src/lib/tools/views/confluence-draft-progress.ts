import type { LiveToolCallDraft } from "../../state/transcript-types";
import type { DraftMetaItem } from "./tool-draft-progress";

type FirstKnownString = (
  draft: LiveToolCallDraft,
  property: string,
) => string | undefined;

export function confluenceDraftPrimaryArg(
  draft: LiveToolCallDraft,
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
  if (toolName === "confluence_download_pages") {
    return (
      firstKnownString(draft, "page_id") ??
      firstKnownString(draft, "space_key") ??
      firstKnownString(draft, "space_id") ??
      firstKnownString(draft, "cql")
    );
  }
  if (toolName === "confluence_create_page") {
    return (
      firstKnownString(draft, "title") ?? firstKnownString(draft, "page_file")
    );
  }
  if (toolName === "confluence_publish_pages") {
    return firstKnownString(draft, "input_path");
  }
  if (toolName === "confluence_upload_attachment") {
    return (
      firstKnownString(draft, "file_path") ?? firstKnownString(draft, "page_id")
    );
  }
  if (
    toolName === "confluence_get_page" ||
    toolName === "confluence_update_page"
  ) {
    return (
      firstKnownString(draft, "page_id") ?? firstKnownString(draft, "page_file")
    );
  }
  return undefined;
}

export function confluenceDraftMeta(
  draft: LiveToolCallDraft,
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
  if (args.include_attachments === true) meta.push({ text: "attachments" });
  if (args.download_attachments === true) meta.push({ text: "download files" });
  if (args.recurse === true) meta.push({ text: "subtree" });
  if (args.dry_run === true) meta.push({ text: "dry run", tone: "info" });
  if (toolName === "confluence_update_page" && args.allow_stale === true) {
    meta.push({ text: "allow stale", tone: "warning" });
  }
  if (toolName === "confluence_publish_pages") {
    if (args.create_missing === true) meta.push({ text: "create missing" });
    if (args.allow_stale === true)
      meta.push({ text: "allow stale", tone: "warning" });
  }
  if (toolName === "confluence_upload_attachment") {
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
