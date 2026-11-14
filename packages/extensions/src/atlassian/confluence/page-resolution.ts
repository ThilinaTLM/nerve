import { jsonObject } from "../shared/http.js";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
} from "./client.js";

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
