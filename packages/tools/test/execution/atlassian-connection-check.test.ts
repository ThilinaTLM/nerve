import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { checkAtlassianConnection } from "../../src/execution/atlassian/connection-check.js";

const connection = {
  siteUrl: "https://example.atlassian.net/",
  email: "developer@example.com",
  token: "secret-token",
};
const originalFetch = globalThis.fetch;

describe("checkAtlassianConnection", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("probes the current-user endpoint of each service", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return Response.json({ accountId: "a" });
    };
    assert.deepEqual(await checkAtlassianConnection(connection, "jira"), {
      status: "verified",
    });
    assert.deepEqual(await checkAtlassianConnection(connection, "confluence"), {
      status: "verified",
    });
    assert.deepEqual(urls, [
      "https://example.atlassian.net/rest/api/3/myself",
      "https://example.atlassian.net/wiki/api/v2/user/current",
    ]);
  });

  for (const [status, expected] of [
    [401, "rejected"],
    [403, "restricted"],
    [404, "unavailable"],
    [429, "unreachable"],
    [503, "unreachable"],
  ] as const) {
    it(`maps HTTP ${status} to ${expected} without leaking the token`, async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: "Bearer secret-token" }), {
          status,
        });
      const result = await checkAtlassianConnection(
        { ...connection, siteUrl: "https://example.atlassian.net" },
        "jira",
      );
      assert.equal(result.status, expected);
      assert.doesNotMatch(result.message ?? "", /secret-token/);
    });
  }

  it("reports network failures as unreachable", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await checkAtlassianConnection(connection, "confluence");
    assert.equal(result.status, "unreachable");
  });
});
