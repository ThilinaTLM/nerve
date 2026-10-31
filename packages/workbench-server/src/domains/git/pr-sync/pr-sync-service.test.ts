import assert from "node:assert/strict";
import { test } from "node:test";
import { githubPrSchema } from "@nervekit/contracts/git";
import { PrSyncService } from "./pr-sync-service.js";

const project = "proj_test";
const pr = githubPrSchema.parse({
  number: 1,
  title: "PR",
  url: "https://github.com/a/b/pull/1",
  state: "OPEN",
  isDraft: false,
  headRefName: "branch",
  baseRefName: "main",
  updatedAt: "2026-11-01T00:00:00Z",
  checks: {
    status: "none",
    total: 0,
    passed: 0,
    pending: 0,
    failed: 0,
    runs: [],
  },
});
function fixture() {
  let now = 100_000,
    probes = 0,
    summaries = 0;
  const events: unknown[] = [];
  let rows = [structuredClone(pr)];
  let truncated = true;
  const service = new PrSyncService(
    {
      prSyncAvailability: async () => ({
        status: "ready",
        repositoryUrl: "https://github.com/a/b",
      }),
      probePullRequests: async () => {
        probes++;
        return { status: 304 as const, headers: new Headers() };
      },
      fetchPrSummaries: async () => {
        summaries++;
        return { prs: structuredClone(rows), viewer: "viewer", truncated };
      },
      probePrChecks: async () => {
        throw new Error("Not expected without head SHA");
      },
    },
    {
      publish: (_type, data) => {
        events.push(data);
      },
    },
    () => now,
  );
  return {
    service,
    events,
    advance: () => (now += 61_000),
    probes: () => probes,
    summaries: () => summaries,
    rows: (next: typeof rows) => (rows = next),
    truncate: () => (truncated = false),
  };
}

void test("snapshot reads return immediately; refresh diffs, revisions, truncation and unchanged probes", async () => {
  const f = fixture();
  try {
    assert.equal(f.service.snapshot(project, ".").revision, 0);
    assert.equal(f.probes(), 0);
    const first = await f.service.refresh(project, ".");
    assert.equal(first.prs.length, 1);
    assert.equal(first.truncated, true);
    assert.equal(first.status, "fresh");
    const count = f.events.length;
    const second = await f.service.refresh(project, ".");
    assert.equal(second.revision, first.revision);
    assert.equal(f.events.length, count);
    f.rows([{ ...pr, title: "Changed" }]);
    f.truncate();
    const third = await f.service.refresh(project, ".");
    assert.equal(third.revision, first.revision + 1);
    assert.equal(third.truncated, false);
    assert.deepEqual((f.events.at(-1) as { changed: number[] }).changed, [1]);
  } finally {
    await f.service.close();
  }
});

void test("closed PR retention follows current branch and tabs, with disconnect cleanup", async () => {
  const f = fixture();
  try {
    f.service.sync("one", {
      projectId: project,
      repo: ".",
      visible: false,
      list: false,
      prs: [1],
      branch: "branch",
    });
    f.rows([{ ...pr, state: "MERGED" }]);
    assert.equal((await f.service.refresh(project, ".")).prs.length, 1);
    f.service.sync("one", {
      projectId: project,
      repo: ".",
      visible: false,
      list: false,
      prs: [],
      branch: "other",
    });
    assert.equal(f.service.snapshot(project, ".").prs.length, 0);
    f.service.releaseOwner("one");
    assert.equal(f.service.watches.owners.size, 0);
  } finally {
    await f.service.close();
  }
});

void test("refresh coalesces overlapping requests to one repository flight", async () => {
  const f = fixture();
  try {
    await Promise.all([
      f.service.refresh(project, "."),
      f.service.refresh(project, "."),
      f.service.refresh(project, "."),
    ]);
    assert.equal(f.probes(), 1);
    assert.equal(f.summaries(), 1);
  } finally {
    await f.service.close();
  }
});

void test("unauthenticated repositories never reach GitHub probes", async () => {
  const f = fixture();
  f.service.git.prSyncAvailability = async () => ({
    status: "unauthenticated",
    repositoryUrl: "https://github.com/a/b",
  });
  try {
    const snapshot = await f.service.refresh(project, ".");
    assert.equal(snapshot.status, "unauthenticated");
    assert.equal(snapshot.repositoryUrl, "https://github.com/a/b");
    assert.equal(f.probes(), 0);
    assert.equal(f.summaries(), 0);
  } finally {
    await f.service.close();
  }
});

void test("rate limit backoff blocks refresh and signals until retry time", async () => {
  const f = fixture();
  const { GithubRateLimitError } = await import("@nervekit/tools/git");
  const probe = f.service.git.probePullRequests;
  let limited = 0;
  f.service.git.probePullRequests = async () => {
    limited++;
    throw new GithubRateLimitError(new Headers({ "retry-after": "60" }));
  };
  try {
    const snapshot = await f.service.refresh(project, ".");
    assert.equal(snapshot.status, "rate_limited");
    assert.equal(snapshot.retryAt, new Date(160_000).toISOString());
    f.service.signal(project, ".");
    await f.service.refresh(project, ".");
    assert.equal(limited, 1);
    f.advance();
    f.service.git.probePullRequests = probe;
    assert.equal((await f.service.refresh(project, ".")).status, "fresh");
  } finally {
    await f.service.close();
  }
});

void test("signals inside the debounce window produce one probe", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let probes = 0;
  let settled!: () => void;
  const fresh = new Promise<void>((resolve) => {
    settled = resolve;
  });
  const service = new PrSyncService(
    {
      prSyncAvailability: async () => ({
        status: "ready",
        repositoryUrl: "https://github.com/a/b",
      }),
      probePullRequests: async () => {
        probes++;
        return { status: 304, headers: new Headers() };
      },
      fetchPrSummaries: async () => ({
        prs: [],
        viewer: "me",
        truncated: false,
      }),
      probePrChecks: async () => {
        throw new Error("No PR heads");
      },
    },
    {
      publish: (_type, event) => {
        if (event.status === "fresh") settled();
      },
    },
    () => 100_000,
  );
  try {
    service.signal(project, ".");
    service.signal(project, ".");
    service.signal(project, ".");
    context.mock.timers.tick(1_999);
    assert.equal(probes, 0);
    context.mock.timers.tick(1);
    await fresh;
    assert.equal(probes, 1);
  } finally {
    await service.close();
  }
});

void test("changing the GitHub remote clears the old repository's PRs even without authentication", async () => {
  const f = fixture();
  try {
    await f.service.refresh(project, ".");
    f.service.git.prSyncAvailability = async () => ({
      status: "unauthenticated",
      repositoryUrl: "https://github.com/other/repo",
    });
    const snapshot = await f.service.refresh(project, ".");
    assert.equal(snapshot.repositoryUrl, "https://github.com/other/repo");
    assert.equal(snapshot.status, "unauthenticated");
    assert.equal(snapshot.updatedAt, null);
    assert.deepEqual(snapshot.prs, []);
  } finally {
    await f.service.close();
  }
});

void test("a visible PR list reuses summary checks; only focused or pending heads are probed", async () => {
  const checked: string[] = [];
  const settled = {
    ...pr,
    headSha: "aaa",
    checks: { ...pr.checks, status: "passing" as const, total: 1, passed: 1 },
  };
  const other = { ...settled, number: 2, headSha: "bbb", headRefName: "other" };
  const service = new PrSyncService(
    {
      prSyncAvailability: async () => ({
        status: "ready",
        repositoryUrl: "https://github.com/a/b",
      }),
      probePullRequests: async () => ({
        status: 304 as const,
        headers: new Headers(),
      }),
      fetchPrSummaries: async () => ({
        prs: [settled, other],
        viewer: "v",
        truncated: false,
      }),
      probePrChecks: async (_p, _r, sha) => {
        checked.push(sha);
        const notModified = { status: 304 as const, headers: new Headers() };
        return { runs: notModified, status: notModified };
      },
    },
    { publish: () => undefined },
  );
  try {
    service.sync("owner", {
      projectId: project,
      repo: ".",
      visible: true,
      list: true,
      prs: [],
    });
    await service.refresh(project, ".");
    assert.deepEqual(checked, []);
    service.sync("owner", {
      projectId: project,
      repo: ".",
      visible: true,
      list: true,
      prs: [],
      branch: "other",
    });
    await service.refresh(project, ".");
    assert.deepEqual(checked, ["bbb"]);
  } finally {
    await service.close();
  }
});
