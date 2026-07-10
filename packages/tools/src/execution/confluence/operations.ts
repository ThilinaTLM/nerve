import { readFile } from "node:fs/promises";
import type { ConfluencePageSummaryPayload } from "@nervekit/contracts";
import type { ToolExecutionContext } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { resolveToolPath } from "../filesystem/path.js";
import {
  type ConfluenceConnection,
  confluenceDownload,
  confluenceRequest,
  pathSegment,
} from "./client.js";
import {
  compactRecord,
  extractBodyRepresentation,
  extractBodyValue,
  summarizeConfluenceAttachment,
  summarizeConfluencePage,
  valuesFromConfluenceList,
} from "./format.js";
import {
  type ConfluencePageRow,
  enumString,
  fetchPageCurrent,
  optionalString,
  pageRowBody,
  pageRowVersionNumber,
  resolveSpaceId,
} from "./helpers.js";

const WRITE_BODY_REPRESENTATIONS = [
  "storage",
  "atlas_doc_format",
  "wiki",
] as const;
const PAGE_STATUSES = ["current", "draft"] as const;

type PagePayload = {
  spaceId?: string;
  title: string;
  parentId?: string;
  status: string;
  body: { representation: string; value: string };
};

export type UpdatePayload = PagePayload & {
  id: string;
  version: { number: number; message?: string };
};

export async function selectPagesForDownload(
  connection: ConfluenceConnection,
  args: Record<string, unknown>,
  options: {
    limit: number;
    depth: number;
    bodyFormat: string;
    signal?: AbortSignal;
  },
): Promise<Record<string, unknown>[]> {
  const pageId = optionalString(args.page_id);
  const cql = optionalString(args.cql);
  const spaceKey = optionalString(args.space_key);
  const spaceIdArg = optionalString(args.space_id);
  if (pageId) {
    const root = await fetchPageWithBody(
      connection,
      pageId,
      options.bodyFormat,
      options.signal,
    );
    if (args.recurse !== true) return [root];
    const descendants = await confluenceRequest(connection, {
      path: `/pages/${pathSegment(pageId)}/descendants`,
      query: {
        limit: Math.max(0, options.limit - 1),
        depth: options.depth,
        "body-format": options.bodyFormat,
      },
      signal: options.signal,
    }).catch(() => ({ results: [] }));
    const descendantPages = valuesFromConfluenceList(descendants) as Record<
      string,
      unknown
    >[];
    const hydrated = await hydratePages(
      connection,
      descendantPages,
      options.bodyFormat,
      options.signal,
    );
    return [root, ...hydrated].slice(0, options.limit);
  }
  if (cql) {
    const response = await confluenceRequest(connection, {
      api: "v1",
      path: "/search",
      query: { cql, limit: options.limit },
      signal: options.signal,
    });
    const pages = valuesFromConfluenceList(response).flatMap((item) => {
      const summary = summarizeConfluencePage(item);
      return summary ? [summary] : [];
    });
    return hydratePages(connection, pages, options.bodyFormat, options.signal);
  }
  if (spaceIdArg || spaceKey) {
    const resolved = await resolveSpaceId(connection, {
      spaceId: spaceIdArg,
      spaceKey,
      signal: options.signal,
    });
    const response = await confluenceRequest(connection, {
      path: `/spaces/${pathSegment(resolved.spaceId)}/pages`,
      query: {
        limit: options.limit,
        "body-format": options.bodyFormat,
      },
      signal: options.signal,
    });
    const pages = valuesFromConfluenceList(response) as Record<
      string,
      unknown
    >[];
    return hydratePages(connection, pages, options.bodyFormat, options.signal);
  }
  throw new ToolExecutionError(
    "CONFLUENCE_DOWNLOAD_TARGET_REQUIRED",
    "Provide page_id, space_key, space_id, or cql to download Confluence pages.",
  );
}

async function hydratePages(
  connection: ConfluenceConnection,
  pages: Array<Record<string, unknown> | ConfluencePageSummaryPayload>,
  bodyFormat: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const hydrated: Record<string, unknown>[] = [];
  for (const page of pages) {
    const summary = summarizeConfluencePage(page);
    if (!summary) continue;
    if (extractBodyValue(page)) {
      hydrated.push(page as Record<string, unknown>);
    } else {
      hydrated.push(
        await fetchPageWithBody(connection, summary.id, bodyFormat, signal),
      );
    }
  }
  return hydrated;
}

async function fetchPageWithBody(
  connection: ConfluenceConnection,
  pageId: string,
  bodyFormat: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return confluenceRequest<Record<string, unknown>>(connection, {
    path: `/pages/${pathSegment(pageId)}`,
    query: { "body-format": bodyFormat },
    signal,
  });
}

export async function fetchAttachments(
  connection: ConfluenceConnection,
  pageId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return confluenceRequest(connection, {
    path: `/pages/${pathSegment(pageId)}/attachments`,
    query: { limit: 100 },
    signal,
  });
}

export async function downloadAttachments(
  connection: ConfluenceConnection,
  attachments: unknown[],
  signal?: AbortSignal,
): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  const downloaded: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const attachment of attachments) {
    const summary = summarizeConfluenceAttachment(attachment);
    if (!summary?.downloadLink) continue;
    downloaded.push({
      filename:
        summary.filename ?? summary.title ?? summary.fileId ?? "attachment",
      bytes: await confluenceDownload(connection, summary.downloadLink, signal),
    });
  }
  return downloaded;
}

export async function buildCreatePayload(
  connection: ConfluenceConnection,
  args: Record<string, unknown>,
  row: ConfluencePageRow | undefined,
  context: ToolExecutionContext,
): Promise<PagePayload> {
  const title = optionalString(args.title) ?? optionalString(row?.title);
  if (!title) throw new Error("title is required.");
  const body = await resolveBody(args, row, context);
  const spaceId = optionalString(args.space_id) ?? optionalString(row?.spaceId);
  const spaceKey =
    optionalString(args.space_key) ?? optionalString(row?.spaceKey);
  const resolved = await resolveSpaceId(connection, {
    spaceId,
    spaceKey,
    signal: context.signal,
  });
  return compactRecord({
    spaceId: resolved.spaceId,
    title,
    parentId: optionalString(args.parent_id) ?? optionalString(row?.parentId),
    status: enumString(args.status ?? row?.status, PAGE_STATUSES, "current"),
    body,
  }) as PagePayload;
}

export async function buildUpdatePayload(
  connection: ConfluenceConnection,
  args: Record<string, unknown>,
  row: ConfluencePageRow | undefined,
  context: ToolExecutionContext,
): Promise<UpdatePayload> {
  const pageId = optionalString(args.page_id) ?? optionalString(row?.id);
  if (!pageId) throw new Error("page_id is required.");
  const current = await fetchPageCurrent(connection, pageId, context.signal);
  const currentSummary = summarizeConfluencePage(current);
  const currentVersion = currentSummary?.versionNumber;
  if (currentVersion === undefined) {
    throw new ToolExecutionError(
      "CONFLUENCE_VERSION_UNKNOWN",
      `Could not determine current version for Confluence page ${pageId}.`,
    );
  }
  const rowVersion = row ? pageRowVersionNumber(row) : undefined;
  if (
    rowVersion !== undefined &&
    rowVersion < currentVersion &&
    args.allow_stale !== true
  ) {
    throw new ToolExecutionError(
      "CONFLUENCE_VERSION_CONFLICT",
      `Page file version ${rowVersion} is older than current Confluence version ${currentVersion}; re-download or set allow_stale=true.`,
      { pageId, rowVersion, currentVersion },
    );
  }
  const explicitBody = await resolveBody(args, row, context, {
    fallback: extractBodyValue(current),
    fallbackRepresentation: extractBodyRepresentation(current, "storage"),
  });
  const title =
    optionalString(args.title) ??
    optionalString(row?.title) ??
    currentSummary?.title;
  if (!title) throw new Error("title is required.");
  return compactRecord({
    id: pageId,
    title,
    parentId:
      optionalString(args.parent_id) ??
      optionalString(row?.parentId) ??
      currentSummary?.parentId,
    status: enumString(
      args.status ?? row?.status ?? currentSummary?.status,
      PAGE_STATUSES,
      "current",
    ),
    body: explicitBody,
    version: compactRecord({
      number: currentVersion + 1,
      message:
        optionalString(args.version_message) ??
        optionalString(row?.version?.message),
    }),
  }) as UpdatePayload;
}

async function resolveBody(
  args: Record<string, unknown>,
  row: ConfluencePageRow | undefined,
  context: ToolExecutionContext,
  options: { fallback?: string; fallbackRepresentation?: string } = {},
): Promise<{ representation: string; value: string }> {
  const inlineBody = optionalString(args.body);
  const bodyFile = optionalString(args.body_file);
  if (inlineBody && bodyFile) {
    throw new ToolExecutionError(
      "CONFLUENCE_BODY_CONFLICT",
      "Provide either body or body_file, not both.",
    );
  }
  const rowBody = row ? pageRowBody(row) : undefined;
  const representation = enumString(
    args.body_representation ??
      rowBody?.representation ??
      options.fallbackRepresentation,
    WRITE_BODY_REPRESENTATIONS,
    "storage",
  );
  if (inlineBody) return { representation, value: inlineBody };
  if (bodyFile) {
    const path = resolveToolPath(context.cwd, bodyFile);
    return { representation, value: await readFile(path, "utf8") };
  }
  if (rowBody)
    return { representation: rowBody.representation, value: rowBody.value };
  if (options.fallback !== undefined) {
    return { representation, value: options.fallback };
  }
  throw new Error("body, body_file, or page_file body is required.");
}
