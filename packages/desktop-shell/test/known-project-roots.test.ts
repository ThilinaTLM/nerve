import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KnownProjectRoots } from "../src/ipc/known-project-roots.js";

const project = (id: string, directory: string) => ({
  id,
  name: id,
  directory,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function setup(options: { daemon?: boolean; body?: unknown; status?: number }) {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  let now = 0;
  const roots = new KnownProjectRoots({
    getDaemon: () =>
      options.daemon === false
        ? undefined
        : { url: "http://127.0.0.1:1", token: "tok" },
    now: () => now,
    ttlMs: 1000,
    realpath: async (path) => `real:${path}`,
    fetch: (async (url: URL, init: RequestInit) => {
      calls.push({
        url: String(url),
        auth: (init.headers as Record<string, string>).authorization,
      });
      return new Response(JSON.stringify(options.body), {
        status: options.status ?? 200,
      });
    }) as typeof fetch,
  });
  return { roots, calls, advance: (ms: number) => (now += ms) };
}

describe("KnownProjectRoots", () => {
  it("resolves via the authenticated daemon API, realpaths, and caches within the TTL", async () => {
    const { roots, calls, advance } = setup({ body: project("p1", "/w/p1") });
    assert.equal(await roots.resolve("p1"), "real:/w/p1");
    assert.equal(await roots.resolve("p1"), "real:/w/p1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://127.0.0.1:1/api/projects/p1");
    assert.equal(calls[0]?.auth, "Bearer tok");
    advance(1001);
    await roots.resolve("p1");
    assert.equal(calls.length, 2);
  });

  it("fails closed when the daemon is missing, errors, or answers for another project", async () => {
    await assert.rejects(setup({ daemon: false }).roots.resolve("p1"));
    await assert.rejects(setup({ status: 500, body: {} }).roots.resolve("p1"));
    await assert.rejects(
      setup({ body: project("other", "/w/o") }).roots.resolve("p1"),
      /different project/,
    );
  });
});
