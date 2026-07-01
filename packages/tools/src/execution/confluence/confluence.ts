import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ConfluencePublishOutcomePayload } from "@nervekit/shared";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { resolveToolPath } from "../filesystem/path.js";
import {
  confluenceAttachmentRequest,
  confluenceRequest,
  pathSegment,
  requireConfluenceConnection,
} from "./client.js";
import {
  type DownloadBundlePage,
  writeDownloadBundle,
  writePageSidecars,
} from "./files.js";
import {
  buildConfluenceTextResult,
  type ConfluenceArtifact,
  displayLimitNotice,
  formatPageSummaryLine,
  formatPublishOutcomeLine,
  formatSpaceSummaryLine,
  nextCursorFromResponse,
  summarizeConfluenceAttachment,
  summarizeConfluencePage,
  summarizeConfluenceSpace,
  takeDisplayItems,
  valuesFromConfluenceList,
  writeConfluenceArtifact,
} from "./format.js";
import {
  boundedNumber,
  enumString,
  fetchPageCurrent,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  readPageRowsFromPath,
  readSinglePageRow,
  requiredString,
  resolveSpaceId,
} from "./helpers.js";
import {
  buildCreatePayload,
  buildUpdatePayload,
  downloadAttachments,
  fetchAttachments,
  selectPagesForDownload,
} from "./operations.js";

const READ_BODY_FORMATS = ["storage", "atlas_doc_format"] as const;
const PAGE_BODY_FORMATS = [
  "storage",
  "atlas_doc_format",
  "view",
  "export_view",
  "anonymous_export_view",
  "styled_view",
  "editor",
] as const;
export async function executeConfluenceSearchSpaces(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const limit = boundedNumber(args.limit, 25, 1, 100);
  const data = await confluenceRequest(connection, {
    path: "/spaces",
    query: {
      query: optionalString(args.query),
      keys: optionalStringArray(args.keys),
      ids: optionalStringArray(args.ids),
      limit,
      cursor: optionalString(args.cursor),
    },
    signal: context.signal,
  });
  const artifact = await maybeArtifact(
    context,
    "search-spaces",
    data,
    args.save_to_file,
  );
  const spaces = valuesFromConfluenceList(data).flatMap((space) => {
    const summary = summarizeConfluenceSpace(space);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(spaces);
  const nextCursor = nextCursorFromResponse(data);
  const lines = [
    `Confluence space search returned ${spaces.length} space${spaces.length === 1 ? "" : "s"}.`,
  ];
  if (nextCursor) lines.push(`Next cursor: ${nextCursor}`);
  const notice = displayLimitNotice({
    noun: "space",
    total: spaces.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (notice) lines.push(notice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatSpaceSummaryLine));
  }
  return buildConfluenceTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      action: "search_spaces",
      query: optionalString(args.query),
      spaces: displayed.items,
      spaceCount: spaces.length,
      displayedSpaceCount: displayed.displayed,
      nextCursor,
    },
  });
}

export async function executeConfluenceSearchPages(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const limit = boundedNumber(args.limit, 25, 1, 100);
  const bodyFormat = enumString(args.body_format, READ_BODY_FORMATS, "storage");
  const cqlArg = optionalString(args.cql);
  const queryArg = optionalString(args.query);
  const spaceKey = optionalString(args.space_key);
  const spaceIdArg = optionalString(args.space_id);
  let data: unknown;
  let cql: string | undefined = cqlArg;
  let resolvedSpaceId = spaceIdArg;

  if (cqlArg || queryArg) {
    cql = cqlArg ?? buildTextSearchCql(queryArg ?? "", spaceKey);
    data = await confluenceRequest(connection, {
      api: "v1",
      path: "/search",
      query: { cql, limit, cursor: optionalString(args.cursor) },
      signal: context.signal,
    });
  } else {
    if (!resolvedSpaceId && spaceKey) {
      resolvedSpaceId = (
        await resolveSpaceId(connection, { spaceKey, signal: context.signal })
      ).spaceId;
    }
    data = await confluenceRequest(connection, {
      path: "/pages",
      query: {
        "space-id": resolvedSpaceId,
        title: optionalString(args.title),
        status: optionalString(args.status),
        "body-format": bodyFormat,
        limit,
        cursor: optionalString(args.cursor),
      },
      signal: context.signal,
    });
  }

  const artifact = await maybeArtifact(
    context,
    "search-pages",
    data,
    args.save_to_file,
  );
  const pages = valuesFromConfluenceList(data).flatMap((page) => {
    const summary = summarizeConfluencePage(page);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(pages);
  const nextCursor = nextCursorFromResponse(data);
  const lines = [
    `Confluence page search returned ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
  ];
  if (cql) lines.push(`CQL: ${cql}`);
  if (nextCursor) lines.push(`Next cursor: ${nextCursor}`);
  const notice = displayLimitNotice({
    noun: "page",
    total: pages.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (notice) lines.push(notice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatPageSummaryLine));
  }
  return buildConfluenceTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      action: "search_pages",
      query: queryArg,
      cql,
      spaceId: resolvedSpaceId,
      spaceKey,
      bodyFormat,
      pages: displayed.items,
      pageCount: pages.length,
      displayedPageCount: displayed.displayed,
      nextCursor,
    },
  });
}

export async function executeConfluenceGetPage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const pageId = requiredString(args.page_id, "page_id");
  const bodyFormat = enumString(args.body_format, PAGE_BODY_FORMATS, "storage");
  const page = await confluenceRequest<Record<string, unknown>>(connection, {
    path: `/pages/${pathSegment(pageId)}`,
    query: {
      "body-format": bodyFormat,
      "include-labels": optionalBoolean(args.include_labels),
      "include-properties": optionalBoolean(args.include_properties),
      "include-operations": optionalBoolean(args.include_operations),
      "include-versions": optionalBoolean(args.include_versions),
      "include-version": optionalBoolean(args.include_version),
    },
    signal: context.signal,
  });
  const result: Record<string, unknown> = { page };
  if (args.include_direct_children === true) {
    result.directChildren = await confluenceRequest(connection, {
      path: `/pages/${pathSegment(pageId)}/direct-children`,
      query: { limit: 100 },
      signal: context.signal,
    }).catch(() =>
      confluenceRequest(connection, {
        path: `/pages/${pathSegment(pageId)}/children`,
        query: { limit: 100 },
        signal: context.signal,
      }),
    );
  }
  if (args.include_attachments === true) {
    result.attachments = await fetchAttachments(
      connection,
      pageId,
      context.signal,
    );
  }
  if (args.include_versions === true) {
    result.versions = await confluenceRequest(connection, {
      path: `/pages/${pathSegment(pageId)}/versions`,
      query: { limit: 50 },
      signal: context.signal,
    }).catch(() => result.versions);
  }

  const artifact = await maybeArtifact(
    context,
    "get-page",
    result,
    args.save_to_file,
  );
  const sidecars =
    args.markdown === true
      ? await writePageSidecars(context, page, { bodyFormat, markdown: true })
      : undefined;
  const pageSummary = summarizeConfluencePage({
    ...page,
    storagePath: sidecars?.storagePath,
    markdownPath: sidecars?.markdownPath,
  });
  const includedCounts: Record<string, number> = {};
  const lines = [
    pageSummary
      ? formatPageSummaryLine(pageSummary)
      : `Confluence page ${pageId}`,
  ];
  const directChildren = valuesFromConfluenceList(result.directChildren);
  if (directChildren.length > 0) {
    includedCounts.directChildren = directChildren.length;
    lines.push(`Direct children: ${directChildren.length}`);
  }
  const attachments = valuesFromConfluenceList(result.attachments);
  const attachmentSummaries = attachments.flatMap((attachment) => {
    const summary = summarizeConfluenceAttachment(attachment);
    return summary ? [summary] : [];
  });
  if (attachmentSummaries.length > 0) {
    includedCounts.attachments = attachmentSummaries.length;
    lines.push(`Attachments: ${attachmentSummaries.length}`);
  }
  const versions = valuesFromConfluenceList(result.versions);
  if (versions.length > 0) {
    includedCounts.versions = versions.length;
    lines.push(`Versions: ${versions.length}`);
  }
  if (sidecars?.storagePath)
    lines.push(`Body saved to: ${sidecars.storagePath}`);
  if (sidecars?.markdownPath) {
    lines.push(`Markdown sidecar saved to: ${sidecars.markdownPath}`);
  }
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildConfluenceTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    artifacts: sidecars?.artifacts,
    details: {
      action: "get_page",
      pageId,
      bodyFormat,
      page: pageSummary,
      attachments: attachmentSummaries,
      attachmentCount: attachmentSummaries.length || undefined,
      displayedAttachmentCount: attachmentSummaries.length || undefined,
      includedCounts,
    },
  });
}

export async function executeConfluenceDownloadPages(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const limit = boundedNumber(args.limit, 50, 1, 250);
  const depth = boundedNumber(args.depth, 1, 1, 10);
  const bodyFormat = enumString(args.body_format, READ_BODY_FORMATS, "storage");
  const pages = await selectPagesForDownload(connection, args, {
    limit,
    depth,
    bodyFormat,
    signal: context.signal,
  });
  const bundlePages: DownloadBundlePage[] = [];
  for (const page of pages.slice(0, limit)) {
    const summary = summarizeConfluencePage(page);
    if (!summary) continue;
    const attachments =
      args.include_attachments === true || args.download_attachments === true
        ? valuesFromConfluenceList(
            await fetchAttachments(connection, summary.id, context.signal),
          )
        : [];
    const downloadedAttachments =
      args.download_attachments === true
        ? await downloadAttachments(connection, attachments, context.signal)
        : undefined;
    bundlePages.push({ page, attachments, downloadedAttachments });
  }
  const root = downloadRoot(args, bundlePages);
  const bundle = await writeDownloadBundle(context, {
    siteUrl: connection.siteUrl,
    root,
    pages: bundlePages,
    bodyFormat,
    markdown: args.markdown === true,
  });
  const pageSummaries = bundle.pages.flatMap((page) => {
    const summary = summarizeConfluencePage(page);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(pageSummaries);
  const lines = [
    `Downloaded ${pageSummaries.length} Confluence page${pageSummaries.length === 1 ? "" : "s"} to ${bundle.dir}.`,
    `Manifest: ${bundle.manifestPath}`,
    `Pages JSONL: ${bundle.pagesJsonlPath}`,
  ];
  if (bundle.downloadedAttachmentCount > 0) {
    lines.push(`Downloaded attachments: ${bundle.downloadedAttachmentCount}`);
  }
  const notice = displayLimitNotice({
    noun: "page",
    total: pageSummaries.length,
    displayed: displayed.displayed,
    artifactPath: bundle.manifestPath,
  });
  if (notice) lines.push(notice);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatPageSummaryLine));
  }
  return buildConfluenceTextResult({
    text: lines.join("\n"),
    context,
    artifacts: bundle.artifacts,
    details: {
      action: "download_pages",
      bodyFormat,
      downloadDir: bundle.dir,
      manifestPath: bundle.manifestPath,
      pagesJsonlPath: bundle.pagesJsonlPath,
      pages: displayed.items,
      pageCount: pageSummaries.length,
      displayedPageCount: displayed.displayed,
      includedCounts: {
        pages: pageSummaries.length,
        downloadedAttachments: bundle.downloadedAttachmentCount,
      },
    },
  });
}

export async function executeConfluenceCreatePage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const row = args.page_file
    ? (await readSinglePageRow(context.cwd, args.page_file)).row
    : undefined;
  const payload = await buildCreatePayload(connection, args, row, context);
  if (args.dry_run === true) {
    return buildConfluenceTextResult({
      text: `Dry run: Confluence page would be created in space ${payload.spaceId}.`,
      context,
      details: {
        action: "create_page",
        dryRun: true,
        spaceId: payload.spaceId,
        title: payload.title,
        payload,
      },
    });
  }
  const data = await confluenceRequest<Record<string, unknown>>(connection, {
    method: "POST",
    path: "/pages",
    body: payload,
    signal: context.signal,
  });
  const returnedPage =
    args.return_page === true && optionalString(data.id)
      ? await fetchPageCurrent(
          connection,
          optionalString(data.id) ?? "",
          context.signal,
        )
      : undefined;
  const pageSummary = summarizeConfluencePage(returnedPage ?? data);
  const artifact = await maybeArtifact(
    context,
    "create-page",
    { response: data, returnedPage },
    args.save_to_file,
  );
  const id = optionalString(data.id) ?? pageSummary?.id ?? "(unknown)";
  return buildConfluenceTextResult({
    text: `Created Confluence page ${id}.`,
    context,
    artifact,
    details: {
      action: "create_page",
      pageId: id,
      spaceId: payload.spaceId,
      title: payload.title,
      page: pageSummary,
    },
  });
}

export async function executeConfluenceUpdatePage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const row = args.page_file
    ? (await readSinglePageRow(context.cwd, args.page_file)).row
    : undefined;
  const payload = await buildUpdatePayload(connection, args, row, context);
  if (args.dry_run === true) {
    return buildConfluenceTextResult({
      text: `Dry run: Confluence page ${payload.id} would be updated to version ${payload.version.number}.`,
      context,
      details: {
        action: "update_page",
        dryRun: true,
        pageId: payload.id,
        title: payload.title,
        payload,
      },
    });
  }
  const data = await confluenceRequest<Record<string, unknown>>(connection, {
    method: "PUT",
    path: `/pages/${pathSegment(payload.id)}`,
    body: payload,
    signal: context.signal,
  });
  const returnedPage =
    args.return_page === true
      ? await fetchPageCurrent(connection, payload.id, context.signal)
      : undefined;
  const pageSummary = summarizeConfluencePage(returnedPage ?? data);
  const artifact = await maybeArtifact(
    context,
    "update-page",
    { response: data, returnedPage },
    args.save_to_file,
  );
  return buildConfluenceTextResult({
    text: `Updated Confluence page ${payload.id} to version ${payload.version.number}.`,
    context,
    artifact,
    details: {
      action: "update_page",
      pageId: payload.id,
      title: payload.title,
      page: pageSummary,
    },
  });
}

export async function executeConfluencePublishPages(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const inputPath = requiredString(args.input_path, "input_path");
  const { rows, path } = await readPageRowsFromPath(context.cwd, inputPath);
  const limit = boundedNumber(args.limit, rows.length, 1, 250);
  const selectedRows = rows.slice(0, limit);
  const outcomes: ConfluencePublishOutcomePayload[] = [];
  for (const [index, row] of selectedRows.entries()) {
    const id = optionalString(row.id);
    try {
      if (id) {
        const payload = await buildUpdatePayload(
          connection,
          args,
          row,
          context,
        );
        if (args.dry_run === true) {
          outcomes.push({
            index,
            operation: "update",
            id,
            title: payload.title,
            status: "dry_run",
            message: `Would update to version ${payload.version.number}.`,
          });
        } else {
          await confluenceRequest(connection, {
            method: "PUT",
            path: `/pages/${pathSegment(id)}`,
            body: payload,
            signal: context.signal,
          });
          outcomes.push({
            index,
            operation: "update",
            id,
            title: payload.title,
            status: "updated",
            message: `Updated to version ${payload.version.number}.`,
          });
        }
      } else if (args.create_missing === true) {
        const payload = await buildCreatePayload(
          connection,
          args,
          row,
          context,
        );
        if (args.dry_run === true) {
          outcomes.push({
            index,
            operation: "create",
            title: payload.title,
            status: "dry_run",
            message: `Would create in space ${payload.spaceId}.`,
          });
        } else {
          const data = await confluenceRequest<Record<string, unknown>>(
            connection,
            {
              method: "POST",
              path: "/pages",
              body: payload,
              signal: context.signal,
            },
          );
          outcomes.push({
            index,
            operation: "create",
            id: optionalString(data.id),
            title: payload.title,
            status: "created",
          });
        }
      } else {
        outcomes.push({
          index,
          operation: "create",
          title: optionalString(row.title),
          status: "skipped",
          message: "Row has no id; set create_missing=true to create it.",
        });
      }
    } catch (error) {
      outcomes.push({
        index,
        operation: id ? "update" : "create",
        id,
        title: optionalString(row.title),
        status: "error",
        errorCode: error instanceof ToolExecutionError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const report = {
    inputPath: path,
    dryRun: args.dry_run === true,
    totalRows: rows.length,
    processedRows: selectedRows.length,
    outcomes,
  };
  const artifact = await maybeArtifact(
    context,
    "publish-pages",
    report,
    args.save_to_file,
  );
  const displayed = takeDisplayItems(outcomes);
  const lines = [
    `${args.dry_run === true ? "Dry run: " : ""}Processed ${selectedRows.length} Confluence page row${selectedRows.length === 1 ? "" : "s"} from ${path}.`,
  ];
  if (artifact) lines.push(`Publish report saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatPublishOutcomeLine));
  }
  const notice = displayLimitNotice({
    noun: "outcome",
    total: outcomes.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (notice) lines.push(notice);
  return buildConfluenceTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: {
      action: "publish_pages",
      inputPath: path,
      dryRun: args.dry_run === true,
      outcomes: displayed.items,
      outcomeCount: outcomes.length,
      displayedOutcomeCount: displayed.displayed,
    },
  });
}

export async function executeConfluenceUploadAttachment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const pageId = requiredString(args.page_id, "page_id");
  const filePath = resolveToolPath(context.cwd, args.file_path);
  const bytes = await readFile(filePath);
  const filename = optionalString(args.filename) ?? basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  form.append("minorEdit", String(args.minor_edit !== false));
  const comment = optionalString(args.comment);
  if (comment) form.append("comment", comment);
  const data = await confluenceAttachmentRequest(connection, {
    method: args.update_existing === false ? "POST" : "PUT",
    pageId,
    form,
    query: { status: optionalString(args.status) },
    signal: context.signal,
  });
  const rawAttachment = valuesFromConfluenceList(data)[0] ?? data;
  const attachmentSummary = summarizeConfluenceAttachment(rawAttachment) ?? {
    filename,
  };
  const snippet = attachmentStorageSnippet(filename);
  const attachment = { ...attachmentSummary, snippet };
  const artifact = await maybeArtifact(
    context,
    "upload-attachment",
    data,
    args.save_to_file,
  );
  const lines = [
    `Uploaded Confluence attachment ${filename} to page ${pageId}.`,
    `Storage XML image snippet: ${snippet}`,
  ];
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildConfluenceTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: {
      action: "upload_attachment",
      pageId,
      attachment,
      attachments: [attachment],
      attachmentCount: 1,
      displayedAttachmentCount: 1,
    },
  });
}

function downloadRoot(
  args: Record<string, unknown>,
  pages: DownloadBundlePage[],
): Record<string, unknown> {
  const pageId = optionalString(args.page_id);
  if (pageId) return { kind: "page", id: pageId };
  const spaceId = optionalString(args.space_id);
  if (spaceId) return { kind: "space", id: spaceId };
  const spaceKey = optionalString(args.space_key);
  if (spaceKey) return { kind: "space", key: spaceKey };
  const cql = optionalString(args.cql);
  if (cql) return { kind: "cql", cql };
  const first = summarizeConfluencePage(pages[0]?.page);
  return first ? { kind: "page", id: first.id } : { kind: "unknown" };
}

function buildTextSearchCql(
  query: string,
  spaceKey: string | undefined,
): string {
  const parts = ["type = page", `text ~ "${escapeCql(query)}"`];
  if (spaceKey) parts.push(`space = "${escapeCql(spaceKey)}"`);
  return parts.join(" and ");
}

function escapeCql(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function attachmentStorageSnippet(filename: string): string {
  return `<ac:image><ri:attachment ri:filename="${escapeXmlAttribute(filename)}" /></ac:image>`;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function maybeArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
  saveToFile: unknown,
): Promise<ConfluenceArtifact | undefined> {
  if (saveToFile === false) return undefined;
  return writeConfluenceArtifact(context, kind, payload);
}
