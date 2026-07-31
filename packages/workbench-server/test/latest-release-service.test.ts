import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LatestReleaseService } from "../src/domains/status/latest-release-service.js";

const githubRelease = {
  tag_name: "v0.16.0",
  html_url: "https://github.com/ThilinaTLM/nerve/releases/tag/v0.16.0",
  published_at: "2026-08-01T10:00:00Z",
};

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("LatestReleaseService", () => {
  it("normalizes the GitHub tag and caches successful results for one hour", async () => {
    let now = 0;
    let calls = 0;
    const service = new LatestReleaseService({
      now: () => now,
      fetch: async () => {
        calls += 1;
        return response(githubRelease);
      },
    });

    assert.deepEqual(await service.getLatestRelease(), {
      version: "0.16.0",
      releaseUrl: githubRelease.html_url,
      publishedAt: githubRelease.published_at,
    });
    now = 60 * 60_000 - 1;
    await service.getLatestRelease();
    assert.equal(calls, 1);

    now += 2;
    await service.getLatestRelease();
    assert.equal(calls, 2);
  });

  it("coalesces concurrent refreshes", async () => {
    const pending = deferred<Response>();
    let calls = 0;
    const service = new LatestReleaseService({
      fetch: () => {
        calls += 1;
        return pending.promise;
      },
    });

    const first = service.getLatestRelease();
    const second = service.getLatestRelease();
    assert.equal(calls, 1);
    pending.resolve(response(githubRelease));

    assert.deepEqual(await first, await second);
    assert.equal(calls, 1);
  });

  it("does not cache HTTP or payload failures", async () => {
    let calls = 0;
    const service = new LatestReleaseService({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return response({}, { status: 503 });
        if (calls === 2) return response({ tag_name: "v0.16.0" });
        return response(githubRelease);
      },
    });

    await assert.rejects(() => service.getLatestRelease(), /503/);
    await assert.rejects(() => service.getLatestRelease());
    assert.equal((await service.getLatestRelease()).version, "0.16.0");
    assert.equal(calls, 3);
  });
});
