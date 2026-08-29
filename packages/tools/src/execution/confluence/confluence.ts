import type {
  IntegrationExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import {
  enumSet,
  optionalString,
  optionalStringArray,
  requiredString,
} from "../atlassian/arguments.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import {
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
  displayLimitNotice,
  formatPageSummaryLine,
  formatSpaceSummaryLine,
  nextCursorFromResponse,
  pageWebUrl,
  summarizeConfluenceAttachment,
  summarizeConfluenceComment,
  summarizeConfluenceLabel,
  summarizeConfluencePage,
  summarizeConfluenceProperty,
  summarizeConfluenceRestrictions,
  summarizeConfluenceSpace,
  takeDisplayItems,
  valuesFromConfluenceList,
  writeConfluenceArtifact,
} from "./format.js";
import { boundedNumber } from "../atlassian/arguments.js";
import {
  enumString,
  fetchPageCurrent,
  readSinglePageRow,
  resolveSpaceId,
} from "./helpers.js";
import {
  buildCreatePayload,
  buildUpdatePayload,
  downloadAttachments,
  fetchAttachments,
} from "./operations.js";

export {
  executeConfluenceManageAttachment,
  executeConfluenceManageComment,
  executeConfluenceManageLabel,
  executeConfluenceManagePage,
  executeConfluenceManageRestriction,
} from "./resources.js";

const READ_BODY_FORMATS = ["storage", "atlas_doc_format"] as const;
const RELATED_PREVIEW_LIMIT = 3;
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
  context: IntegrationExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const limit = boundedNumber(args.limit, 25, 1, 100);
  const data = await confluenceRequest(connection, {
    path: "/spaces",
    query: {
      keys: optionalStringArray(args.keys),
      ids: optionalStringArray(args.ids),
      limit,
      cursor: optionalString(args.cursor),
    },
    signal: context.signal,
  });
  const artifact = await writeConfluenceArtifact(
    context,
    "search-spaces",
    data,
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
  lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatSpaceSummaryLine));
  }
  return buildConfluenceTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      action: "search_spaces",
      spaces: displayed.items,
      spaceCount: spaces.length,
      displayedSpaceCount: displayed.displayed,
      nextCursor,
    },
  });
}

export async function executeConfluenceSearchPages(
  args: Record<string, unknown>,
  context: IntegrationExecutionContext,
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

  const artifact = await writeConfluenceArtifact(context, "search-pages", data);
  const pages = valuesFromConfluenceList(data).flatMap((page) => {
    const summary = summarizeConfluencePage(page);
    if (!summary) return [];
    const compactSummary = { ...summary };
    delete compactSummary.bodyPreview;
    return [
      { ...compactSummary, webUrl: pageWebUrl(connection.siteUrl, page) },
    ];
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
  lines.push(`Raw JSON saved to: ${artifact.path}`);
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
  context: IntegrationExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const pageId = requiredString(args.page_id, "page_id");
  const bodyFormat = enumString(args.body_format, PAGE_BODY_FORMATS, "storage");
  const include = enumSet(args.include, [
    "labels",
    "properties",
    "operations",
    "version",
    "versions",
    "children",
    "attachments",
    "footer_comments",
    "inline_comments",
    "restrictions",
  ] as const);
  const page = await confluenceRequest<Record<string, unknown>>(connection, {
    path: `/pages/${pathSegment(pageId)}`,
    query: {
      "body-format": bodyFormat,
      "include-labels": include.has("labels") || undefined,
      "include-properties": include.has("properties") || undefined,
      "include-operations": include.has("operations") || undefined,
      "include-versions": include.has("versions") || undefined,
      "include-version": include.has("version") || undefined,
    },
    signal: context.signal,
  });
  const result: Record<string, unknown> = { page };
  if (include.has("children")) {
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
  if (include.has("attachments")) {
    result.attachments = await fetchAttachments(
      connection,
      pageId,
      context.signal,
    );
  }
  if (include.has("footer_comments")) {
    result.footerComments = await confluenceRequest(connection, {
      path: `/pages/${pathSegment(pageId)}/footer-comments`,
      query: {
        limit: boundedNumber(args.comment_limit, 25, 1, 100),
        cursor: optionalString(args.comment_cursor),
        "body-format": bodyFormat,
      },
      signal: context.signal,
    });
  }
  if (include.has("inline_comments")) {
    result.inlineComments = await confluenceRequest(connection, {
      path: `/pages/${pathSegment(pageId)}/inline-comments`,
      query: {
        limit: boundedNumber(args.comment_limit, 25, 1, 100),
        cursor: optionalString(args.comment_cursor),
        "body-format": bodyFormat,
      },
      signal: context.signal,
    });
  }
  if (include.has("restrictions")) {
    result.restrictions = await confluenceRequest(connection, {
      api: "v1",
      path: `/content/${pathSegment(pageId)}/restriction/byOperation`,
      signal: context.signal,
    });
  }
  if (include.has("versions")) {
    result.versions = await confluenceRequest(connection, {
      path: `/pages/${pathSegment(pageId)}/versions`,
      query: { limit: 50 },
      signal: context.signal,
    }).catch(() => result.versions);
  }

  const artifact = await writeConfluenceArtifact(context, "get-page", result);
  const sidecars =
    args.markdown === true
      ? await writePageSidecars(context, page, { bodyFormat, markdown: true })
      : undefined;
  const rawPageSummary = summarizeConfluencePage({
    ...page,
    storagePath: sidecars?.storagePath,
    markdownPath: sidecars?.markdownPath,
  });
  const pageSummary = rawPageSummary
    ? { ...rawPageSummary, webUrl: pageWebUrl(connection.siteUrl, page) }
    : undefined;
  const includedCounts: Record<string, number> = {};
  const lines = [
    pageSummary
      ? formatPageSummaryLine(pageSummary)
      : `Confluence page ${pageId}`,
  ];
  if (pageSummary?.bodyPreview) lines.push(`Body: ${pageSummary.bodyPreview}`);
  if (pageSummary?.webUrl) lines.push(`Web: ${pageSummary.webUrl}`);

  const childPages = summarizeConfluenceRelated(
    valuesFromConfluenceList(result.directChildren).map((child) => ({
      raw: child,
      summary: summarizeConfluencePage(child),
    })),
    ({ raw, summary }) =>
      summary
        ? {
            ...summary,
            bodyPreview: undefined,
            webUrl: pageWebUrl(connection.siteUrl, raw),
          }
        : undefined,
  );
  if (include.has("children")) {
    includedCounts.directChildren = childPages.total;
    appendConfluencePreview(
      lines,
      "Direct children",
      childPages.items,
      childPages.total,
      artifact?.path,
      (item) =>
        `- ${item.id}${item.title ? ` · ${item.title}` : ""}${item.webUrl ? ` · ${item.webUrl}` : ""}`,
    );
  }

  const attachmentSummaries = summarizeConfluenceRelated(
    valuesFromConfluenceList(result.attachments),
    summarizeConfluenceAttachment,
  );
  if (include.has("attachments")) {
    includedCounts.attachments = attachmentSummaries.total;
    appendConfluencePreview(
      lines,
      "Attachments",
      attachmentSummaries.items,
      attachmentSummaries.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? item.fileId ?? "unknown id"}${item.filename ? ` · ${item.filename}` : ""}${item.mediaType ? ` · ${item.mediaType}` : ""}`,
    );
  }

  const versions = valuesFromConfluenceList(result.versions);
  if (include.has("versions")) {
    includedCounts.versions = versions.length;
    lines.push(`Versions: ${versions.length}`);
  }

  const footerComments = summarizeConfluenceRelated(
    valuesFromConfluenceList(result.footerComments),
    (item) => summarizeConfluenceComment(item, "footer"),
  );
  if (include.has("footer_comments")) {
    includedCounts.footerComments = footerComments.total;
    appendConfluencePreview(
      lines,
      "Footer comments",
      footerComments.items,
      footerComments.total,
      artifact?.path,
      formatConfluenceCommentPreview,
    );
  }
  const inlineComments = summarizeConfluenceRelated(
    valuesFromConfluenceList(result.inlineComments),
    (item) => summarizeConfluenceComment(item, "inline"),
  );
  if (include.has("inline_comments")) {
    includedCounts.inlineComments = inlineComments.total;
    appendConfluencePreview(
      lines,
      "Inline comments",
      inlineComments.items,
      inlineComments.total,
      artifact?.path,
      formatConfluenceCommentPreview,
    );
  }

  const properties = summarizeConfluenceRelated(
    valuesFromConfluenceList(page.properties),
    summarizeConfluenceProperty,
  );
  if (include.has("properties")) {
    includedCounts.properties = properties.total;
    appendConfluencePreview(
      lines,
      "Properties",
      properties.items,
      properties.total,
      artifact?.path,
      (item) =>
        `- ${item.id ?? item.key} · ${item.key}${item.valuePreview ? ` — ${item.valuePreview}` : ""}`,
    );
  }
  const labels = summarizeConfluenceRelated(
    valuesFromConfluenceList(page.labels),
    summarizeConfluenceLabel,
  );
  if (include.has("labels")) {
    includedCounts.labels = labels.total;
    appendConfluencePreview(
      lines,
      "Labels",
      labels.items,
      labels.total,
      artifact?.path,
      (item) => `- ${item.prefix ? `${item.prefix}:` : ""}${item.name}`,
    );
  }
  const restrictions = summarizeConfluenceRelated(
    summarizeConfluenceRestrictions(result.restrictions),
    (item) => item,
  );
  if (include.has("restrictions")) {
    includedCounts.restrictions = restrictions.total;
    lines.push(`Restrictions: ${restrictions.total}`);
  }
  if (sidecars?.storagePath)
    lines.push(`Body saved to: ${sidecars.storagePath}`);
  if (sidecars?.markdownPath) {
    lines.push(`Markdown sidecar saved to: ${sidecars.markdownPath}`);
  }
  lines.push(`Raw JSON saved to: ${artifact.path}`);
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
      attachments:
        attachmentSummaries.items.length > 0
          ? attachmentSummaries.items
          : undefined,
      attachmentCount: attachmentSummaries.total || undefined,
      displayedAttachmentCount: attachmentSummaries.items.length || undefined,
      childPages: childPages.items.length > 0 ? childPages.items : undefined,
      displayedChildPageCount: childPages.items.length || undefined,
      footerComments:
        footerComments.items.length > 0 ? footerComments.items : undefined,
      displayedFooterCommentCount: footerComments.items.length || undefined,
      inlineComments:
        inlineComments.items.length > 0 ? inlineComments.items : undefined,
      displayedInlineCommentCount: inlineComments.items.length || undefined,
      properties: properties.items.length > 0 ? properties.items : undefined,
      displayedPropertyCount: properties.items.length || undefined,
      labels: labels.items.length > 0 ? labels.items : undefined,
      restrictions:
        restrictions.items.length > 0 ? restrictions.items : undefined,
      includedCounts,
    },
  });
}

function summarizeConfluenceRelated<TInput, TSummary>(
  value: TInput[],
  summarize: (item: TInput) => TSummary | undefined,
): { items: TSummary[]; total: number } {
  const summaries = value.flatMap((item) => {
    const summary = summarize(item);
    return summary ? [summary] : [];
  });
  return {
    items: summaries.slice(0, RELATED_PREVIEW_LIMIT),
    total: summaries.length,
  };
}

function appendConfluencePreview<T>(
  lines: string[],
  label: string,
  items: T[],
  total: number,
  artifactPath: string | undefined,
  format: (item: T) => string,
): void {
  lines.push(`${label}: ${total}`);
  if (items.length > 0) lines.push(...items.map(format));
  if (total <= items.length) return;
  lines.push(
    artifactPath
      ? `Showing first ${items.length} of ${total}; full data is saved to ${artifactPath}.`
      : `Showing first ${items.length} of ${total}; complete data is unavailable.`,
  );
}

function formatConfluenceCommentPreview(item: {
  id?: string;
  author?: string;
  bodyPreview?: string;
}): string {
  return `- ${item.id ?? "unknown id"}${item.author ? ` · ${item.author}` : ""}${item.bodyPreview ? ` — ${item.bodyPreview}` : ""}`;
}

export async function executeConfluenceDownloadPage(
  args: Record<string, unknown>,
  context: IntegrationExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const pageId = requiredString(args.page_id, "page_id");
  const bodyFormat = enumString(args.body_format, READ_BODY_FORMATS, "storage");
  const page = await confluenceRequest<Record<string, unknown>>(connection, {
    path: `/pages/${pathSegment(pageId)}`,
    query: { "body-format": bodyFormat },
    signal: context.signal,
  });
  const summary = summarizeConfluencePage(page);
  if (!summary)
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_NOT_FOUND",
      `Confluence page ${pageId} could not be summarized.`,
    );
  const attachmentMode = enumString(
    args.attachments,
    ["none", "metadata", "download"] as const,
    "none",
  );
  const attachments =
    attachmentMode === "none"
      ? []
      : valuesFromConfluenceList(
          await fetchAttachments(connection, pageId, context.signal),
        );
  const downloadedAttachments =
    attachmentMode === "download"
      ? await downloadAttachments(connection, attachments, context.signal)
      : undefined;
  const bundlePages: DownloadBundlePage[] = [
    { page, attachments, downloadedAttachments },
  ];
  const root = { kind: "page", id: pageId };
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
      action: "download_page",
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
  context: IntegrationExecutionContext,
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
        operation: "create_page",
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
  const artifact = await writeConfluenceArtifact(context, "create-page", {
    response: data,
    returnedPage,
  });
  const id = optionalString(data.id) ?? pageSummary?.id ?? "(unknown)";
  return buildConfluenceTextResult({
    text: `Created Confluence page ${id}.`,
    context,
    artifact,
    details: {
      action: "create_page",
      operation: "create_page",
      pageId: id,
      spaceId: payload.spaceId,
      title: payload.title,
      page: pageSummary,
    },
  });
}

export async function executeConfluenceUpdatePage(
  args: Record<string, unknown>,
  context: IntegrationExecutionContext,
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
        operation: "update_page",
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
  const artifact = await writeConfluenceArtifact(context, "update-page", {
    response: data,
    returnedPage,
  });
  return buildConfluenceTextResult({
    text: `Updated Confluence page ${payload.id} to version ${payload.version.number}.`,
    context,
    artifact,
    details: {
      action: "update_page",
      operation: "update_page",
      pageId: payload.id,
      title: payload.title,
      page: pageSummary,
    },
  });
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
