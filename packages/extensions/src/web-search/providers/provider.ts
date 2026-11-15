import {
  ExtensionError,
  type AccountKind,
  type ExtensionContext,
  type ExtensionErrorCode,
} from "@nervekit/extension-api";

/** What every provider is asked, whatever its API looks like. */
export type SearchRequest = {
  query: string;
  limit: number;
  /** Also return the provider's synthesized answer, when it has one. */
  includeAnswer: boolean;
  /** The `account` setting whose selected account signs the request (`ctx.http` `auth`). */
  accountField: string;
};

/** One result in the shape all providers normalise to. */
export type SearchHit = {
  title: string;
  url: string;
  /** The provider's text for the page; unbounded (`search.web` shortens it). */
  content: string;
  published?: string;
};

export type SearchResponse = { answer?: string; hits: SearchHit[] };

/**
 * A search backend, selected by the kind of the chosen account. Adding one is a
 * new file in `providers/` listed in `providers/index.ts`: its account kind
 * (credential, origins, optional `test`) and a `search` that returns hits in
 * the shape above. Its origins join the extension's network permissions.
 */
export interface SearchProvider {
  /** The account kind this provider serves (the key of `account`). */
  kind: string;
  account: AccountKind;
  search(
    ctx: ExtensionContext,
    request: SearchRequest,
  ): Promise<SearchResponse>;
}

/** The host error code for a failed HTTP status. */
export function httpCode(status: number): ExtensionErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST";
}

export function parseJson(body: unknown, provider: string): unknown {
  try {
    return JSON.parse(String(body));
  } catch {
    throw new ExtensionError(
      "SERVER_ERROR",
      `${provider} returned a response that is not JSON.`,
    );
  }
}
