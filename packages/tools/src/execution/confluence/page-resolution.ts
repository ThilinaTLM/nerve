import { jsonObject } from "../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
} from "./client.js";

export function enumString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export async function fetchPageCurrent(
  connection: ConfluenceConnection,
  pageId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return confluenceRequest(connection, {
    parse: jsonObject,
    path: `/pages/${pathSegment(pageId)}`,
    query: { "body-format": "storage" },
    signal,
  });
}
