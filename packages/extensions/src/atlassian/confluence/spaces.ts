import { jsonObject } from "../shared/http.js";
import { confluenceRequest } from "./client.js";
import { valuesFromConfluenceList } from "./format.js";
import { resolveSpaceId } from "./space-resolution.js";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { closeMatches } from "@nervekit/tools/quick-script/runtime/sdk-args";
import type { SdkEnvironment } from "@nervekit/tools/quick-script/runtime/sdk-types";

const MAX_SPACE_PAGES = 10;

type SpaceSummary = { id: string; key: string; name: string; type: unknown };

/** Lists spaces (up to 2500), optionally those whose key or name contains `needle`. */
export async function listSpaces(
  env: SdkEnvironment,
  needle = "",
): Promise<SpaceSummary[]> {
  const connection = await env.confluence();
  const lowered = needle.toLowerCase();
  const spaces: SpaceSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SPACE_PAGES; page++) {
    const response = await confluenceRequest(connection, {
      parse: jsonObject,
      path: "/spaces",
      query: { limit: 250, cursor },
      signal: env.context.signal,
    });
    for (const raw of valuesFromConfluenceList(response)) {
      const space = raw as Record<string, unknown>;
      const key = String(space.key ?? "");
      const name = String(space.name ?? "");
      if (
        lowered &&
        !key.toLowerCase().includes(lowered) &&
        !name.toLowerCase().includes(lowered)
      ) {
        continue;
      }
      spaces.push({ id: String(space.id ?? ""), key, name, type: space.type });
    }
    const next = (response._links as { next?: unknown } | undefined)?.next;
    cursor =
      typeof next === "string"
        ? (new URL(next, "https://example.invalid").searchParams.get(
            "cursor",
          ) ?? undefined)
        : undefined;
    if (!cursor) break;
  }
  return spaces;
}

/** Resolves a space key (or the configured default); an unknown key lists close matches. */
export async function resolveSpace(
  env: SdkEnvironment,
  space: string | undefined,
) {
  const connection = await env.confluence();
  try {
    return await resolveSpaceId(connection, {
      spaceKey: space,
      signal: env.context.signal,
    });
  } catch (error) {
    if (
      space &&
      error instanceof ToolExecutionError &&
      error.code === "CONFLUENCE_SPACE_NOT_FOUND"
    ) {
      const all = await listSpaces(env);
      const close = closeMatches(
        space,
        all.flatMap((entry) => [entry.key, entry.name]),
      ).map(
        (match) => all.find((s) => s.key === match || s.name === match)!.key,
      );
      throw new Error(
        `No Confluence space with key "${space}".${close.length ? ` Did you mean: ${[...new Set(close)].join(", ")}?` : ""} Use confluence.spaces.search({ query }) to find space keys.`,
        { cause: error },
      );
    }
    throw error;
  }
}
