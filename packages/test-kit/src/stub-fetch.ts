import type { CleanupContext } from "./temp-dir.js";

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export type FetchHandler = (
  url: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

/** Builds a JSON `Response` (default status 200). */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

/** Replaces `globalThis.fetch` with `handler` for the test and restores it afterwards. Returns the recorded calls. */
export function stubFetch(
  t: CleanupContext,
  handler: FetchHandler,
): { calls: FetchCall[] } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return { calls };
}
