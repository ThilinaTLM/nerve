import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type {
  GitOverviewResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import {
  GitWorkspaceSync,
  type GitBranchChange,
} from "./git-workspace-sync-service.js";
import {
  GIT_WORKSPACE_DEBOUNCE_MS,
  GIT_WORKSPACE_STRUCTURE_CHECK_MS,
  GIT_WORKSPACE_UNCERTAIN_POLL_MS,
} from "./git-workspace-sync-policy.js";

const project = "proj_test";

const summary = (repo: string, branch = "main", changes = 0) =>
  ({
    relativePath: repo,
    absDir: `/p/${repo}`,
    name: repo,
    isRepo: true,
    currentBranch: branch,
    detached: false,
    changeCount: changes,
    dirty: changes > 0,
  }) as unknown as GitRepoSummary;

class FakeBackend {
  repos = new Map<string, { branch: string; changes: number; stash: string }>();
  discoveries = 0;
  overviews: string[] = [];
  summaryReads: string[] = [];
  listings = 0;
  failing = new Set<string>();
  outside: Array<{ worktreeGroup: string; count: number }> = [];
  gate?: Promise<void>;
  add(repo: string, branch = "main") {
    this.repos.set(repo, { branch, changes: 0, stash: "a" });
  }
  async discoverRepos() {
    this.discoveries++;
    return {
      projectIsRepo: false,
      repos: [...this.repos].map(([repo, state]) =>
        summary(repo, state.branch, state.changes),
      ),
      errors: [],
      outsideWorktrees: this.outside,
    };
  }
  async overview(
    _projectId: string,
    repo: string,
  ): Promise<GitOverviewResponse> {
    this.overviews.push(repo);
    await this.gate;
    if (this.failing.has(repo)) throw new Error("boom");
    const state = this.repos.get(repo);
    if (!state) throw new Error("missing");
    return {
      repo: summary(repo, state.branch, state.changes),
      baseBranch: "main",
      onBaseBranch: true,
      files: Array.from({ length: state.changes }, (_, i) => ({
        path: `f${i}`,
        index: " ",
        worktree: "M",
        staged: false,
        untracked: false,
      })),
      stagedCount: 0,
      unstagedCount: state.changes,
      untrackedCount: 0,
      recentCommits: [],
      stashes: [
        {
          index: 0,
          ref: "stash@{0}",
          hash: "abcdefg",
          message: state.stash,
          relativeDate: String(Date.now()),
        },
      ],
    };
  }
  async repoSummary(_projectId: string, repo: string) {
    this.summaryReads.push(repo);
    await this.gate;
    if (this.failing.has(repo)) throw new Error("boom");
    const state = this.repos.get(repo);
    if (!state) throw new Error("missing");
    return summary(repo, state.branch, state.changes);
  }
  async listRepositoryPaths() {
    this.listings++;
    return [...this.repos.keys()].sort();
  }
  resolveRepoDir(_projectId: string, repo: string) {
    return `/p/${repo}`;
  }
}

class FakeMonitor {
  calls: Array<{ owner: string; repos: string[] }> = [];
  degraded = new Set<string>();
  async setRepositories(
    owner: string,
    _projectId: string,
    repos: Array<{ repo: string }>,
  ) {
    this.calls.push({ owner, repos: repos.map((r) => r.repo) });
    return new Map(
      repos.map(({ repo }) => [repo, { degraded: this.degraded.has(repo) }]),
    );
  }
  async clearRepositories() {}
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

function fixture(concurrency?: number) {
  const backend = new FakeBackend();
  const monitor = new FakeMonitor();
  const events: Array<{ revision: number; repos: string[]; detail: string[] }> =
    [];
  const branches: GitBranchChange[] = [];
  const service = new GitWorkspaceSync(
    backend,
    monitor,
    { publish: (_type, data) => void events.push(data) },
    { concurrency, onBranchChanged: (change) => void branches.push(change) },
  );
  return { backend, monitor, events, branches, service };
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

/** Mock timers run callbacks at the end of a tick, so advance in small steps. */
const tick = async (ms: number) => {
  for (let left = ms; left > 0; left -= 100) {
    mock.timers.tick(Math.min(100, left));
    await flush();
  }
};

void test("nothing is read without demand; monitor notices only mark dirty", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  assert.equal(f.backend.discoveries, 1);
  await f.service.clear("s1", project);
  f.service.onNotice(project, "api");
  await tick(5_000);
  assert.deepEqual(f.backend.summaryReads, []);
  assert.equal(f.backend.discoveries, 1);
  await f.service.close();
});

void test("the snapshot exposes worktrees outside the project", async () => {
  const f = fixture();
  f.backend.add("api");
  f.backend.outside = [{ worktreeGroup: "api-group", count: 2 }];
  const snapshot = await f.service.snapshot(project);
  assert.deepEqual(snapshot.outsideWorktrees, [
    { worktreeGroup: "api-group", count: 2 },
  ]);
  await f.service.close();
});

void test("revision bumps only when content changes and events carry the changed repos", async () => {
  const f = fixture();
  f.backend.add("api");
  f.backend.add("ui");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  const first = await f.service.snapshot(project);
  assert.equal(first.loaded, true);
  assert.deepEqual(
    first.summaries.map((s) => s.relativePath),
    ["api", "ui"],
  );
  const revision = first.revision;
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.branches.map((b) => b.repo).sort(), ["api", "ui"]);

  // Notice without content change: read happens, revision stays.
  f.service.onNotice(project, "api");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  assert.equal((await f.service.snapshot(project)).revision, revision);
  assert.equal(f.events.length, 1);

  f.backend.repos.get("api")!.changes = 2;
  f.service.onNotice(project, "api");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  const after = await f.service.snapshot(project);
  assert.equal(after.revision, revision + 1);
  assert.equal(after.summaries[0].changeCount, 2);
  assert.deepEqual(f.events.at(-1), {
    projectId: project,
    revision: revision + 1,
    repos: ["api"],
    detail: [],
  });
  await f.service.close();
});

void test("a burst of notices debounces into one read; a change during a read yields exactly one follow-up", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  let release!: () => void;
  f.backend.gate = new Promise<void>((resolve) => (release = resolve));
  for (let i = 0; i < 5; i++) {
    f.service.onNotice(project, "api");
    await tick(50);
  }
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  // In flight: several changes coalesce into a single follow-up.
  for (let i = 0; i < 4; i++) f.service.onNotice(project, "api");
  f.backend.gate = undefined;
  release();
  await flush();
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads, ["api", "api"]);
  await tick(10_000);
  assert.equal(f.backend.summaryReads.length, 2);
  await f.service.close();
});

void test("editing an already-changed file bumps the detail revision without changing the payload", async () => {
  const backend = new FakeBackend();
  const events: Array<{ revision: number; repos: string[]; detail: string[] }> =
    [];
  let signature = "f0:1:100";
  const service = new GitWorkspaceSync(
    backend,
    new FakeMonitor(),
    { publish: (_type, data) => void events.push(data) },
    { fileSignature: async () => signature },
  );
  backend.add("ui");
  backend.repos.get("ui")!.changes = 1;
  await service.sync("s1", {
    projectId: project,
    visible: false,
    detail: ["ui"],
  });
  await flush();
  const before = await service.detail(project, "ui");
  service.onNotice(project, "ui");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.equal((await service.detail(project, "ui")).revision, before.revision);
  signature = "f0:5:200";
  service.onNotice(project, "ui");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  const after = await service.detail(project, "ui");
  assert.ok(after.revision > before.revision);
  assert.deepEqual(after.files, before.files);
  assert.ok(events.at(-1)!.detail.includes("ui"));
  await service.close();
});

void test("several detail repositories stay live for one connection", async () => {
  const f = fixture();
  for (const repo of ["api", "ui", "web"]) f.backend.add(repo);
  await f.service.sync("s1", {
    projectId: project,
    visible: false,
    detail: ["api", "ui"],
  });
  await flush();
  assert.equal((await f.service.detail(project, "api")).stale, false);
  assert.equal((await f.service.detail(project, "ui")).stale, false);
  f.backend.overviews.length = 0;
  f.backend.repos.get("api")!.changes = 2;
  f.backend.repos.get("ui")!.changes = 2;
  f.service.onNotice(project, "api");
  f.service.onNotice(project, "ui");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual([...f.backend.overviews].sort(), ["api", "ui"]);
  await f.service.close();
});

void test("detail tier: only the demanded repository holds files; released on clear", async () => {
  const f = fixture();
  f.backend.add("api");
  f.backend.add("ui");
  f.backend.repos.get("ui")!.changes = 1;
  await f.service.sync("s1", {
    projectId: project,
    visible: true,
    detail: ["ui"],
  });
  await flush();
  const detail = await f.service.detail(project, "ui");
  assert.equal(detail.files.length, 1);
  assert.equal(detail.stale, false);
  const revision = detail.revision;
  // Stash age text moves with the clock but is not content.
  f.service.onNotice(project, "ui");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.equal((await f.service.detail(project, "ui")).revision, revision);

  f.backend.repos.get("ui")!.changes = 3;
  f.service.onNotice(project, "ui");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  const changed = await f.service.detail(project, "ui");
  assert.equal(changed.files.length, 3);
  assert.ok(changed.revision > revision);
  assert.ok(f.events.at(-1)!.detail.includes("ui"));

  // Without demand the detail is read on request but not retained.
  await f.service.clear("s1", project);
  f.backend.overviews.length = 0;
  await f.service.detail(project, "api");
  await f.service.detail(project, "api");
  assert.equal(f.backend.overviews.length, 2);
  await f.service.close();
});

void test("demand is released when the owner disconnects; shared demand stays", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.sync("s1", { projectId: project, visible: true });
  await f.service.sync("s2", { projectId: project, visible: true });
  await flush();
  f.service.releaseOwner("s1");
  f.service.onNotice(project, "api");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  f.service.releaseOwner("s2");
  f.service.onNotice(project, "api");
  await tick(5_000);
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  assert.equal((await f.service.snapshot(project)).stale, true);
  // New demand re-discovers because the monitor was not watching meanwhile.
  await f.service.sync("s3", { projectId: project, visible: true });
  await flush();
  assert.equal(f.backend.discoveries, 2);
  await f.service.close();
});

void test("sync drives monitor demand for all repositories and reports degraded scopes", async () => {
  const f = fixture();
  f.backend.add("api");
  f.backend.add("ui");
  f.monitor.degraded.add("ui");
  await f.service.sync("s1", {
    projectId: project,
    visible: true,
    hint: "api",
  });
  await flush();
  const last = f.monitor.calls.at(-1)!;
  assert.equal(last.owner, "s1");
  assert.deepEqual(last.repos.sort(), ["api", "ui"]);
  const state = await f.service.sync("s1", {
    projectId: project,
    visible: true,
  });
  assert.equal(state.degraded, true);
  await f.service.close();
});

void test("uncertain scopes fall back to a slow poll for that scope only", async () => {
  const f = fixture();
  f.backend.add("api");
  f.backend.add("ui");
  f.monitor.degraded.add("ui");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  f.backend.summaryReads.length = 0;
  await tick(GIT_WORKSPACE_UNCERTAIN_POLL_MS - 1_000);
  assert.deepEqual(f.backend.summaryReads, []);
  await tick(2_000 + GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads, ["ui"]);
  // A poll-uncertain notice is no evidence of change: it only opts the scope
  // into the slow poll, which reads once the last read is old enough.
  f.backend.summaryReads.length = 0;
  await tick(1_000);
  f.service.onNotice(project, "api", { refreshCause: "uncertain_poll" });
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  f.backend.summaryReads.length = 0;
  await tick(10_000);
  assert.deepEqual(f.backend.summaryReads, []);
  await f.service.close();
});

void test("mutations read their repository first and return the including revision", async () => {
  const f = fixture(1);
  f.backend.add("api");
  f.backend.add("ui");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  f.backend.summaryReads.length = 0;
  f.backend.repos.get("ui")!.changes = 4;
  f.backend.repos.get("api")!.changes = 1;
  f.service.onNotice(project, "api");
  const before = (await f.service.snapshot(project)).revision;
  f.service.markDirty(project, "ui", { priority: true });
  const revision = await f.service.mutated(project, "ui");
  assert.equal(f.backend.summaryReads[0], "ui");
  assert.equal(revision, before + 1);
  assert.equal(
    (await f.service.snapshot(project)).summaries.find(
      (s) => s.relativePath === "ui",
    )?.changeCount,
    4,
  );
  await f.service.close();
});

void test("mutations on an undemanded project read nothing", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.snapshot(project);
  f.backend.summaryReads.length = 0;
  const revision = await f.service.mutated(project, "api");
  assert.equal(f.backend.summaryReads.length, 0);
  assert.equal(revision, (await f.service.snapshot(project)).revision);
  await f.service.close();
});

void test("branch changes notify the PR hook", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  f.branches.length = 0;
  f.backend.repos.get("api")!.branch = "feature";
  f.service.onNotice(project, "api");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.branches, [
    {
      projectId: project,
      repo: "api",
      branch: "feature",
      detached: false,
      previous: "main",
    },
  ]);
  await f.service.close();
});

void test("failed reads surface as errors and stale flags without losing the last summary", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  f.backend.failing.add("api");
  f.service.onNotice(project, "api");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  const view = await f.service.snapshot(project);
  assert.equal(view.summaries.length, 1);
  assert.equal(view.errors[0]?.repo, "api");
  assert.deepEqual(view.staleRepos, ["api"]);
  await f.service.close();
});

void test("summary tier never reads the file list; only demanded detail uses the overview", async () => {
  const f = fixture();
  f.backend.add("api");
  f.backend.add("ui");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  f.service.onNotice(project, "api");
  f.service.onNotice(project, "ui");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.summaryReads.sort(), ["api", "ui"]);
  assert.deepEqual(f.backend.overviews, []);
  await f.service.sync("s1", {
    projectId: project,
    visible: true,
    detail: ["ui"],
  });
  await flush();
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.overviews, ["ui"]);
  f.service.onNotice(project, "ui");
  f.service.onNotice(project, "api");
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  assert.deepEqual(f.backend.overviews, ["ui", "ui"]);
  assert.equal(f.backend.summaryReads.filter((r) => r === "api").length, 2);
  await f.service.close();
});

void test("hint warming yields to visible summary reads even in a visible project", async () => {
  const f = fixture(1);
  f.backend.add("api");
  f.backend.add("ui");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  f.backend.summaryReads.length = 0;
  f.service.onNotice(project, "api");
  await f.service.sync("s1", { projectId: project, visible: true, hint: "ui" });
  await tick(GIT_WORKSPACE_DEBOUNCE_MS);
  // The notice's visible summary goes first; the hint's detail warm-up follows.
  assert.deepEqual(f.backend.summaryReads, ["api"]);
  assert.deepEqual(f.backend.overviews, ["ui"]);
  await f.service.close();
});

void test("worktree entry notices and the periodic structure check re-discover", async () => {
  const f = fixture();
  f.backend.add("api");
  await f.service.sync("s1", { projectId: project, visible: true });
  await flush();
  assert.equal(f.backend.discoveries, 1);

  f.backend.add("api-wt");
  f.service.onNotice(project, "api", { worktreesChanged: true });
  await tick(100);
  assert.equal(f.backend.discoveries, 2);
  assert.deepEqual(
    (await f.service.snapshot(project)).summaries.map((s) => s.relativePath),
    ["api", "api-wt"],
  );

  // No notice at all: the 60 s check notices a new repository.
  f.backend.add("fresh");
  await tick(GIT_WORKSPACE_STRUCTURE_CHECK_MS - 5_000);
  assert.equal(f.backend.discoveries, 2);
  await tick(6_000);
  assert.equal(f.backend.discoveries, 3);
  assert.ok(
    (await f.service.snapshot(project)).summaries.some(
      (s) => s.relativePath === "fresh",
    ),
  );
  // Unchanged structure: checks are cheap listings, not discoveries.
  const listings = f.backend.listings;
  await tick(GIT_WORKSPACE_STRUCTURE_CHECK_MS + 1_000);
  assert.equal(f.backend.discoveries, 3);
  assert.ok(f.backend.listings > listings);
  await f.service.close();
});
