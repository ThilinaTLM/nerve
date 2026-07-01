import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ConfluenceAttachmentSummaryPayload,
  ConfluencePageSummaryPayload,
  ConfluencePublishOutcomePayload,
  ConfluenceSpaceSummaryPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/shared";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { buildProcessTextResult } from "../common/process-result.js";

export const CONFLUENCE_DISPLAY_ITEM_LIMIT = 20;
export const CONFLUENCE_TEXT_FIELD_MAX_CHARS = 300;

export type ConfluenceArtifact = {
  path: string;
  bytes?: number;
  chars?: number;
  lines?: number;
  label?: string;
};

export function confluenceTmpDir(context: ToolExecutionContext): string {
  return context.dataDir
    ? join(context.dataDir, "tmp", "confluence")
    : join(tmpdir(), "nerve-confluence");
}

export async function writeConfluenceArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
): Promise<{ path: string; bytes: number; chars: number; lines: number }> {
  const baseDir = confluenceTmpDir(context);
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const text = JSON.stringify(payload, null, 2);
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 10);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(baseDir, `${kind}-${timestamp}-${hash}.json`);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  return {
    path,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

export async function buildConfluenceTextResult({
  text,
  context,
  details = {},
  artifact,
  artifacts,
}: {
  text: string;
  context: ToolExecutionContext;
  details?: Record<string, unknown>;
  artifact?: ConfluenceArtifact;
  artifacts?: ConfluenceArtifact[];
}): Promise<ToolExecutionResult> {
  const allArtifacts = [...(artifact ? [artifact] : []), ...(artifacts ?? [])];
  const existingOutputLimits = details.outputLimits as
    | ToolOutputLimitsPayload
    | undefined;
  const outputLimits =
    allArtifacts.length > 0
      ? {
          ...(existingOutputLimits ?? {}),
          artifacts: [
            ...(existingOutputLimits?.artifacts ?? []),
            ...allArtifacts.map((item) => ({
              kind: "raw_result" as const,
              path: item.path,
              label: item.label ?? "Raw Confluence JSON",
              bytes: item.bytes,
              chars: item.chars,
              lines: item.lines,
            })),
          ],
        }
      : existingOutputLimits;
  return buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-confluence",
    exitMessagePrefix: "Confluence",
    dataDir: context.dataDir,
    details: { ...details, ...(outputLimits ? { outputLimits } : {}) },
  });
}

export function takeDisplayItems<T>(
  items: T[],
  limit = CONFLUENCE_DISPLAY_ITEM_LIMIT,
): { items: T[]; total: number; displayed: number; omitted: number } {
  const total = items.length;
  const displayedItems = items.slice(0, limit);
  return {
    items: displayedItems,
    total,
    displayed: displayedItems.length,
    omitted: Math.max(0, total - displayedItems.length),
  };
}

export function displayLimitNotice({
  noun,
  total,
  displayed,
  artifactPath,
}: {
  noun: string;
  total: number;
  displayed: number;
  artifactPath?: string;
}): string | undefined {
  if (total <= displayed) return undefined;
  const plural = total === 1 ? noun : `${noun}s`;
  return artifactPath
    ? `Showing first ${displayed} of ${total} ${plural}; full Confluence response is saved to ${artifactPath}.`
    : `Showing first ${displayed} of ${total} ${plural}; narrow the query or save raw JSON for full details.`;
}

export function summarizeConfluenceSpace(
  value: unknown,
): ConfluenceSpaceSummaryPayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = stringField(record.id);
  if (!id) return undefined;
  const homepage = asRecord(record.homepage);
  return compactRecord({
    id,
    key: truncateField(stringField(record.key)),
    name: truncateField(stringField(record.name)),
    type: truncateField(stringField(record.type)),
    status: truncateField(stringField(record.status)),
    homepageId: stringField(record.homepageId) ?? stringField(homepage?.id),
  }) as ConfluenceSpaceSummaryPayload;
}

export function summarizeConfluencePage(
  value: unknown,
): ConfluencePageSummaryPayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const content = asRecord(record.content);
  const source = content ?? record;
  const id = stringField(source.id);
  if (!id) return undefined;
  const space = asRecord(source.space);
  const version = asRecord(source.version);
  const links = asRecord(source.links) ?? asRecord(source._links);
  const parent = asRecord(source.parent);
  const ancestors = Array.isArray(source.ancestors)
    ? source.ancestors
    : undefined;
  const lastAncestor = ancestors?.at(-1);
  return compactRecord({
    id,
    title: truncateField(stringField(source.title)),
    spaceId: stringField(source.spaceId) ?? stringField(space?.id),
    spaceKey: truncateField(
      stringField(source.spaceKey) ?? stringField(space?.key),
    ),
    parentId:
      stringField(source.parentId) ??
      stringField(parent?.id) ??
      stringField(asRecord(lastAncestor)?.id),
    status: truncateField(stringField(source.status)),
    versionNumber: numberField(version?.number ?? source.versionNumber),
    webui: stringField(links?.webui),
    storagePath: stringField(source.storagePath),
    markdownPath: stringField(source.markdownPath),
    attachmentDir: stringField(source.attachmentDir),
  }) as ConfluencePageSummaryPayload;
}

export function summarizeConfluenceAttachment(
  value: unknown,
): ConfluenceAttachmentSummaryPayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = stringField(record.id);
  const fileId = stringField(record.fileId);
  const version = asRecord(record.version);
  const filename =
    stringField(record.filename) ??
    stringField(record.title) ??
    stringField(record.name) ??
    stringField(record.fileName);
  if (!id && !fileId && !filename) return undefined;
  return compactRecord({
    id,
    fileId,
    filename: truncateField(filename),
    title: truncateField(stringField(record.title)),
    mediaType: truncateField(
      stringField(record.mediaType) ?? stringField(record.mimeType),
    ),
    fileSize: numberField(record.fileSize ?? record.size),
    versionNumber: numberField(version?.number ?? record.versionNumber),
    downloadLink: stringField(record.downloadLink),
    path: stringField(record.path),
    snippet: stringField(record.snippet),
  }) as ConfluenceAttachmentSummaryPayload;
}

export function formatSpaceSummaryLine(
  summary: ConfluenceSpaceSummaryPayload,
): string {
  const parts = [
    summary.key ? `${summary.key} (${summary.id})` : summary.id,
    summary.name,
    summary.type,
    summary.status,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}`;
}

export function formatPageSummaryLine(
  summary: ConfluencePageSummaryPayload,
): string {
  const parts = [
    summary.id,
    summary.title,
    summary.spaceKey ? `space ${summary.spaceKey}` : undefined,
    summary.status,
    summary.versionNumber !== undefined
      ? `v${summary.versionNumber}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}`;
}

export function formatAttachmentSummaryLine(
  summary: ConfluenceAttachmentSummaryPayload,
): string {
  const parts = [
    summary.filename ?? summary.title ?? summary.id ?? summary.fileId,
    summary.mediaType,
    summary.fileSize !== undefined ? `${summary.fileSize} bytes` : undefined,
    summary.versionNumber !== undefined
      ? `v${summary.versionNumber}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}`;
}

export function formatPublishOutcomeLine(
  outcome: ConfluencePublishOutcomePayload,
): string {
  const prefix = outcome.status ?? outcome.operation ?? "row";
  const target = [outcome.id, outcome.title].filter(Boolean).join(" · ");
  const message = outcome.message ?? outcome.errorCode;
  return `- ${prefix}${target ? `: ${target}` : ""}${message ? ` — ${message}` : ""}`;
}

export function valuesFromConfluenceList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.values)) return record.values;
  return [];
}

export function nextCursorFromResponse(value: unknown): string | undefined {
  const record = asRecord(value);
  const links = asRecord(record?._links) ?? asRecord(record?.links);
  const next = stringField(links?.next);
  if (!next) return stringField(record?.nextCursor);
  try {
    const url = new URL(next, "https://example.invalid");
    return url.searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

export function extractBodyValue(page: unknown): string | undefined {
  const body = asRecord(asRecord(page)?.body);
  if (!body) return undefined;
  const direct = stringField(body.value);
  if (direct) return direct;
  for (const key of [
    "storage",
    "atlas_doc_format",
    "view",
    "export_view",
    "anonymous_export_view",
    "styled_view",
    "editor",
  ]) {
    const nested = asRecord(body[key]);
    const value = stringField(nested?.value);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function extractBodyRepresentation(
  page: unknown,
  fallback = "storage",
): string {
  const body = asRecord(asRecord(page)?.body);
  if (!body) return fallback;
  const direct = stringField(body.representation);
  if (direct) return direct;
  for (const key of [
    "storage",
    "atlas_doc_format",
    "view",
    "export_view",
    "anonymous_export_view",
    "styled_view",
    "editor",
  ]) {
    if (asRecord(body[key])) return key;
  }
  return fallback;
}

export function pageWebUrl(siteUrl: string, page: unknown): string | undefined {
  const summary = summarizeConfluencePage(page);
  const webui = summary?.webui;
  if (!webui) return undefined;
  if (/^https?:\/\//i.test(webui)) return webui;

  const baseUrl = siteUrl.replace(/\/+$/, "").replace(/\/wiki$/i, "");
  const path = webui.startsWith("/") ? webui : `/${webui}`;
  const wikiPath =
    path === "/wiki" || path.startsWith("/wiki/") ? path : `/wiki${path}`;
  return `${baseUrl}${wikiPath}`;
}

export function truncateField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > CONFLUENCE_TEXT_FIELD_MAX_CHARS
    ? `${value.slice(0, CONFLUENCE_TEXT_FIELD_MAX_CHARS - 1)}…`
    : value;
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
