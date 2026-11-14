/** A Confluence space as shown to a script: text fields bounded, absent fields omitted. */
export type ConfluenceSpaceSummaryPayload = {
  id: string;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
  homepageId?: string;
};

import { trimTrailingSlashes } from "../shared/site-url.js";

export const CONFLUENCE_TEXT_FIELD_MAX_CHARS = 300;

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

export function valuesFromConfluenceList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.values)) return record.values;
  return [];
}

export function pageWebUrl(siteUrl: string, page: unknown): string | undefined {
  const record = asRecord(page);
  const source = asRecord(record?.content) ?? record;
  const links = asRecord(source?.links) ?? asRecord(source?._links);
  const webui = stringField(links?.webui);
  if (!webui) return undefined;
  if (/^https?:\/\//i.test(webui)) return webui;

  const baseUrl = trimTrailingSlashes(siteUrl).replace(/\/wiki$/i, "");
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
