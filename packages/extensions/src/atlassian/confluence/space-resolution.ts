import { ExtensionError } from "@nervekit/extension-api";
import { type ConfluenceConnection, confluenceRequest } from "./client.js";
import {
  summarizeConfluenceSpace,
  valuesFromConfluenceList,
} from "./format.js";

/** No space has the key; scripts see it as `NOT_FOUND`. */
export class SpaceNotFoundError extends ExtensionError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "SpaceNotFoundError";
  }
}

export async function resolveSpaceId(
  connection: ConfluenceConnection,
  options: { spaceId?: string; spaceKey?: string },
): Promise<{ spaceId: string; spaceKey?: string }> {
  if (options.spaceId)
    return { spaceId: options.spaceId, spaceKey: options.spaceKey };
  const spaceKey = options.spaceKey ?? connection.defaultSpaceKey;
  if (!spaceKey) {
    throw new ExtensionError(
      "BAD_REQUEST",
      "space_id or space_key is required because no default Confluence space key is configured.",
    );
  }
  const response = await confluenceRequest(connection, {
    path: "/spaces",
    query: { keys: [spaceKey], limit: 1 },
  });
  const spaces = valuesFromConfluenceList(response).flatMap((space) => {
    const summary = summarizeConfluenceSpace(space);
    return summary ? [summary] : [];
  });
  const match = spaces.find((space) => space.key === spaceKey) ?? spaces[0];
  if (!match) {
    throw new SpaceNotFoundError(
      `No Confluence space matched key "${spaceKey}".`,
    );
  }
  return { spaceId: match.id, spaceKey: match.key ?? spaceKey };
}
