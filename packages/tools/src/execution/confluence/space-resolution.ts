import { ToolExecutionError } from "../errors/tool-error.js";
import { type ConfluenceConnection, confluenceRequest } from "./client.js";
import {
  summarizeConfluenceSpace,
  valuesFromConfluenceList,
} from "./format.js";

export async function resolveSpaceId(
  connection: ConfluenceConnection,
  options: { spaceId?: string; spaceKey?: string; signal?: AbortSignal },
): Promise<{ spaceId: string; spaceKey?: string }> {
  if (options.spaceId)
    return { spaceId: options.spaceId, spaceKey: options.spaceKey };
  const spaceKey = options.spaceKey ?? connection.defaultSpaceKey;
  if (!spaceKey) {
    throw new ToolExecutionError(
      "CONFLUENCE_SPACE_REQUIRED",
      "space_id or space_key is required because no default Confluence space key is configured.",
    );
  }
  const response = await confluenceRequest(connection, {
    path: "/spaces",
    query: { keys: [spaceKey], limit: 1 },
    signal: options.signal,
  });
  const spaces = valuesFromConfluenceList(response).flatMap((space) => {
    const summary = summarizeConfluenceSpace(space);
    return summary ? [summary] : [];
  });
  const match = spaces.find((space) => space.key === spaceKey) ?? spaces[0];
  if (!match) {
    throw new ToolExecutionError(
      "CONFLUENCE_SPACE_NOT_FOUND",
      `No Confluence space matched key "${spaceKey}".`,
    );
  }
  return { spaceId: match.id, spaceKey: match.key ?? spaceKey };
}
