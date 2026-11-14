import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtensionError } from "@nervekit/extension-api";
import {
  createHarness,
  ACCOUNT,
  SITE,
  type FetchLike,
} from "../test-support.js";
import {
  checkAtlassianConnection,
  testAtlassianAccount,
} from "./connection-check.js";

describe("checkAtlassianConnection", () => {
  it("probes the current-user endpoint of each service", async () => {
    const urls: string[] = [];
    const { ctx } = createHarness({
      fetch: async (url) => {
        urls.push(url.toString());
        return Response.json({ accountId: "a" });
      },
    });
    assert.deepEqual(await checkAtlassianConnection(ctx, "jira"), {
      status: "verified",
    });
    assert.deepEqual(await checkAtlassianConnection(ctx, "confluence"), {
      status: "verified",
    });
    assert.deepEqual(urls, [
      `${SITE}/rest/api/3/myself`,
      `${SITE}/wiki/rest/api/user/current`,
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
      const { ctx } = createHarness({
        fetch: async () =>
          new Response(JSON.stringify({ message: "Bearer secret-token" }), {
            status,
          }),
      });
      const result = await checkAtlassianConnection(ctx, "jira");
      assert.equal(result.status, expected);
      assert.doesNotMatch(result.message ?? "", /secret-token/);
    });
  }

  it("reports network failures as unreachable", async () => {
    const { ctx } = createHarness({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await checkAtlassianConnection(ctx, "confluence");
    assert.equal(result.status, "unreachable");
  });
});

describe("the Atlassian account's test hook", () => {
  const harness = (fetch: FetchLike) => createHarness({ fetch }).ctx;

  it("verifies when one service answers and names the other", async () => {
    const ctx = harness(async (url) =>
      url.pathname.startsWith("/wiki")
        ? new Response("missing", { status: 404 })
        : Response.json({ accountId: "a" }),
    );
    const result = await testAtlassianAccount(ACCOUNT, ctx);
    assert.equal(result.ok, true);
    assert.match(result.ok ? (result.message ?? "") : "", /Confluence: /);
  });

  it("reports refused credentials first and needs a site and email", async () => {
    const ctx = harness(async (url) =>
      url.pathname.startsWith("/wiki")
        ? Response.json({})
        : new Response("no", { status: 401 }),
    );
    const rejected = await testAtlassianAccount(ACCOUNT, ctx);
    assert.deepEqual(rejected.ok ? undefined : rejected.reason, "rejected");
    await assert.rejects(
      testAtlassianAccount({ ...ACCOUNT, fields: {} }, ctx),
      (error: unknown) =>
        error instanceof ExtensionError && error.code === "BAD_REQUEST",
    );
  });
});
