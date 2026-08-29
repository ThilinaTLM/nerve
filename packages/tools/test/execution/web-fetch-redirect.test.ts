import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchWithPolicy } from "../../src/execution/web/web-fetch.js";

const publicResolver = async () => ["93.184.216.34"] as const;

describe("web fetch redirect policy", () => {
  it("blocks a public destination that redirects to a private address", async () => {
    let calls = 0;
    await assert.rejects(
      fetchWithPolicy(
        "https://example.com/start",
        new AbortController().signal,
        false,
        {
          resolveHost: publicResolver,
          fetch: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "http://127.0.0.1/private" },
            });
          },
        },
      ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "WEB_FETCH_PRIVATE_NETWORK_DENIED",
    );
    assert.equal(calls, 1);
  });

  it("allows private redirects only when the host opts in", async () => {
    const destinations: string[] = [];
    const result = await fetchWithPolicy(
      "https://example.com/start",
      new AbortController().signal,
      true,
      {
        fetch: async (input) => {
          destinations.push(String(input));
          return destinations.length === 1
            ? new Response(null, {
                status: 302,
                headers: { location: "http://127.0.0.1/private" },
              })
            : new Response("ok", { status: 200 });
        },
      },
    );
    assert.equal(result.url.href, "http://127.0.0.1/private");
    assert.deepEqual(destinations, [
      "https://example.com/start",
      "http://127.0.0.1/private",
    ]);
  });

  it("bounds redirect loops", async () => {
    let calls = 0;
    await assert.rejects(
      fetchWithPolicy(
        "https://example.com/loop",
        new AbortController().signal,
        false,
        {
          resolveHost: publicResolver,
          fetch: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "/loop" },
            });
          },
        },
      ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "WEB_FETCH_TOO_MANY_REDIRECTS",
    );
    assert.equal(calls, 6);
  });
});
