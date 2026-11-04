import { RpcError } from "@nervekit/protocol/rpc";

export type SearchPatternError = { message: string; column?: number };

/** Reads a structured invalid-pattern rejection from a content-search request.
 * Returns undefined for every other failure so callers keep their generic path. */
export function searchPatternError(
  error: unknown,
): SearchPatternError | undefined {
  if (!(error instanceof RpcError)) return undefined;
  const details = error.data.details;
  if (details?.code !== "INVALID_SEARCH_PATTERN") return undefined;
  const column = details.column;
  return {
    message: error.data.message,
    ...(typeof column === "number" ? { column } : {}),
  };
}

export function formatSearchPatternError(error: SearchPatternError): string {
  return error.column === undefined
    ? error.message
    : `${error.message} (column ${error.column})`;
}
