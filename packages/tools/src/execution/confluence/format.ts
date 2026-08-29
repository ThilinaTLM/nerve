import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ConfluenceAttachmentSummaryPayload,
  ConfluenceCommentSummaryPayload,
  ConfluenceLabelSummaryPayload,
  ConfluencePageSummaryPayload,
  ConfluencePropertySummaryPayload,
  ConfluencePublishOutcomePayload,
  ConfluenceRestrictionSummaryPayload,
  ConfluenceSpaceSummaryPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/contracts";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { atlassianPlainTextPreview } from "../atlassian/rich-text.js";
import { buildSemanticTextResult } from "../output/semantic-text-result.js";

export const CONFLUENCE_DISPLAY_ITEM_LIMIT = 20;
export const CONFLUENCE_TEXT_FIELD_MAX_CHARS = 300;

export type ConfluenceArtifact = {
  path: string;
  bytes?: number;
  chars?: number;
  lines?: number;
  label?: string;
  role?: "primary_result" | "supporting_data";
  format?: "markdown" | "text" | "json" | "jsonl" | "directory_manifest";
};

export function confluenceTmpDir(context: ToolExecutionContext): string {
  return (
    context.artifactDir ??
    (context.dataDir
      ? join(context.dataDir, "tmp", "confluence")
      : join(tmpdir(), "nerve-confluence"))
  );
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
  context: _context,
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
  void _context;
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
            ...allArtifacts.map((item, index) => ({
              id: `confluence_artifact_${index + 1}`,
              role: item.role ?? ("supporting_data" as const),
              path: item.path,
              format: {
                kind: item.format ?? ("json" as const),
                mediaType:
                  item.format === "markdown"
                    ? "text/markdown"
                    : item.format === "text"
                      ? "text/plain"
                      : item.format === "jsonl"
                        ? "application/x-ndjson"
                        : "application/json",
                encoding: "utf-8" as const,
              },
              label: item.label ?? "Raw Confluence JSON",
              bytes: item.bytes,
              lines: item.lines,
              recommendedTools: ["read", "grep"] as ("read" | "grep")[],
            })),
          ],
        }
      : existingOutputLimits;
  const normalizedDetails = withConfluenceMutationSummary(details);
  return buildSemanticTextResult(text, {
    ...normalizedDetails,
    ...(outputLimits ? { outputLimits } : {}),
  });
}

function withConfluenceMutationSummary(
  details: Record<string, unknown>,
): Record<string, unknown> {
  if (details.mutationSummary || typeof details.operation !== "string")
    return details;
  const resource = [
    typeof details.pageId === "string"
      ? { kind: "page", id: details.pageId }
      : undefined,
    typeof details.commentId === "string"
      ? { kind: "comment", id: details.commentId }
      : undefined,
    typeof details.attachmentId === "string"
      ? { kind: "attachment", id: details.attachmentId }
      : undefined,
  ].find(Boolean);
  return {
    ...details,
    mutationSummary: {
      operation: details.operation,
      outcome: details.dryRun === true ? "dry_run" : "succeeded",
      resources: resource ? [resource] : [],
      warnings: [],
    },
  };
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
    created: truncateField(stringField(source.createdAt)),
    updated: truncateField(
      stringField(version?.createdAt) ?? stringField(source.updatedAt),
    ),
    bodyPreview: atlassianPlainTextPreview(source.body),
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

export function summarizeConfluenceComment(
  value: unknown,
  kind?: string,
): ConfluenceCommentSummaryPayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const version = asRecord(record.version);
  const body = asRecord(record.body);
  const storage = asRecord(body?.storage);
  const author = asRecord(record.author);
  const id = stringField(record.id);
  if (!id && Object.keys(record).length === 0) return undefined;
  return compactRecord({
    id,
    pageId: stringField(record.pageId),
    kind: kind === "footer" || kind === "inline" ? kind : undefined,
    author: truncateField(
      stringField(author?.displayName) ?? stringField(author?.publicName),
    ),
    bodyPreview: atlassianPlainTextPreview(
      storage?.value ?? body?.value ?? body,
    ),
    resolutionStatus: truncateField(stringField(record.resolutionStatus)),
    versionNumber: numberField(version?.number),
  }) as ConfluenceCommentSummaryPayload;
}

export function summarizeConfluenceProperty(
  value: unknown,
): ConfluencePropertySummaryPayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const version = asRecord(record.version);
  const key = stringField(record.key) ?? stringField(record.name);
  if (!key) return undefined;
  return compactRecord({
    id: stringField(record.id),
    key: truncateField(key),
    versionNumber: numberField(version?.number ?? record.versionNumber),
    valuePreview:
      atlassianPlainTextPreview(record.value) ??
      propertyValuePreview(record.value),
  }) as ConfluencePropertySummaryPayload;
}

function propertyValuePreview(value: unknown): string | undefined {
  const scalars: string[] = [];
  collectPropertyScalars(value, "", scalars, 0);
  return truncateField(scalars.slice(0, 6).join(", ") || undefined);
}

function collectPropertyScalars(
  value: unknown,
  path: string,
  output: string[],
  depth: number,
): void {
  if (output.length >= 6 || depth > 2) return;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    output.push(path ? `${path}=${String(value)}` : String(value));
    return;
  }
  if (Array.isArray(value)) {
    value
      .slice(0, 3)
      .forEach((item, index) =>
        collectPropertyScalars(
          item,
          path ? `${path}[${index}]` : String(index),
          output,
          depth + 1,
        ),
      );
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, item] of Object.entries(record).slice(0, 6)) {
    collectPropertyScalars(
      item,
      path ? `${path}.${key}` : key,
      output,
      depth + 1,
    );
  }
}

export function summarizeConfluenceLabel(
  value: unknown,
): ConfluenceLabelSummaryPayload | undefined {
  if (typeof value === "string") return { name: truncateField(value) ?? value };
  const record = asRecord(value);
  if (!record) return undefined;
  const name = stringField(record.name) ?? stringField(record.label);
  if (!name) return undefined;
  return compactRecord({
    name: truncateField(name),
    prefix: truncateField(stringField(record.prefix)),
  }) as ConfluenceLabelSummaryPayload;
}

export function summarizeConfluenceRestrictions(
  value: unknown,
): ConfluenceRestrictionSummaryPayload[] {
  const records = valuesFromConfluenceList(value);
  return records.flatMap((item) => {
    const record = asRecord(item);
    const operation =
      stringField(record?.operation) ?? stringField(record?.key);
    if (operation !== "read" && operation !== "update") return [];
    const restrictions = asRecord(record?.restrictions);
    const users = valuesFromConfluenceList(restrictions?.user);
    const groups = valuesFromConfluenceList(restrictions?.group);
    const subjects = [
      ...users.map((subject) => ({ subject, subjectType: "user" as const })),
      ...groups.map((subject) => ({ subject, subjectType: "group" as const })),
    ];
    if (subjects.length === 0) return [{ operation }];
    return subjects.map(({ subject, subjectType }) => {
      const subjectRecord = asRecord(subject);
      return compactRecord({
        operation,
        subjectType,
        subjectId:
          stringField(subjectRecord?.accountId) ??
          stringField(subjectRecord?.id) ??
          stringField(subjectRecord?.name),
      }) as ConfluenceRestrictionSummaryPayload;
    });
  });
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
    summary.id ?? summary.fileId,
    summary.filename ?? summary.title,
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
