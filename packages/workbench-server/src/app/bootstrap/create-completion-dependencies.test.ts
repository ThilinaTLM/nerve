import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCompletionDependencies,
  type CompletionRuntimeBindings,
} from "./create-completion-dependencies.js";

type Notice = Parameters<
  Parameters<CompletionRuntimeBindings["events"]["subscribeNotify"]>[0]
>[0];
type CoreChange = Parameters<
  Parameters<CompletionRuntimeBindings["core"]["subscribe"]>[0]
>[0];
type RemoteChange = Parameters<
  Parameters<CompletionRuntimeBindings["git"]["onRemoteCacheChanged"]>[0]
>[0];
function fixture() {
  const notices = new Set<(notice: Notice) => void>();
  const changes = new Set<(change: CoreChange) => void>();
  const remoteChanges = new Set<(change: RemoteChange) => void>();
  const visited: string[] = [];
  let historyReads = 0;
  const unused = async (): Promise<never> => {
    throw new Error("Unused port");
  };
  const project = (id: string) => {
    if (id !== "proj_A") throw new Error("Unknown project");
    return { id, directory: "/synthetic/project" };
  };
  const bindings: CompletionRuntimeBindings = {
    home: "/synthetic/home",
    sources: {
      project,
      capabilities: {
        configuration: unused,
        update: unused,
        subscribe: () => () => undefined,
      },
      profiles: {
        configuration: unused,
        update: unused,
        onChanged: () => () => undefined,
      },
      skills: async () => [],
      tools: [],
      launches: () => [],
      definitions: unused,
      children: () => [],
    },
    git: {
      onRemoteCacheChanged: (listener) => {
        remoteChanges.add(listener);
        return () => {
          remoteChanges.delete(listener);
        };
      },
      discoverRepos: async () =>
        ({
          projectIsRepo: false,
          repos: [{ relativePath: "api" }, { relativePath: "docs" }],
        }) as Awaited<
          ReturnType<CompletionRuntimeBindings["git"]["discoverRepos"]>
        >,
      cachedOpenPrs: (_id, repo) => {
        visited.push(`pr:${repo}`);
        return {
          result: {
            prs: [
              {
                number: 1,
                title: repo,
                url: `https://example.invalid/${repo}/pull/1`,
                state: "OPEN",
                headRefName: "synthetic",
                updatedAt: "2026-01-01T00:00:00.000Z",
                author: "fixture",
              },
            ],
          } as NonNullable<
            ReturnType<
              CompletionRuntimeBindings["git"]["cachedOpenPrs"]
            >["result"]
          >,
          status: repo === "docs" ? "stale" : "fresh",
          refreshing: repo === "docs",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
      listIssues: (_id, repo) => {
        visited.push(`issue:${repo}`);
        if (repo === "docs")
          throw new Error("Synthetic repository unavailable");
        return {
          issues: [
            {
              number: 2,
              title: "Synthetic issue",
              url: "https://example.invalid/api/issues/2",
              state: "OPEN",
              updatedAt: "2026-01-01T00:00:00.000Z",
              author: null,
            },
          ],
          status: "fresh",
          refreshing: false,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    },
    context: {
      project,
      metadata: (id) => {
        if (id !== "conv_A") throw new Error("Unknown conversation");
        return { projectId: "proj_A", lastSequence: 1 };
      },
      history: (_id, page) => {
        historyReads++;
        assert.equal(page.limit, 64);
        return [];
      },
    },
    events: {
      subscribeNotify: (listener) => {
        notices.add(listener);
        return () => {
          notices.delete(listener);
        };
      },
      publishBestEffort: () => undefined,
    },
    core: {
      subscribe: (listener) => {
        changes.add(listener);
        return () => {
          changes.delete(listener);
        };
      },
    },
  };
  return {
    bindings,
    visited,
    notices,
    changes,
    remoteChanges,
    get historyReads() {
      return historyReads;
    },
  };
}

void test("completion authorization and context use cheap metadata; unchanged sequence reuses bounded history", async () => {
  const ctx = fixture();
  const deps = createCompletionDependencies(ctx.bindings);
  assert.throws(
    () => deps.authorize({ projectId: "unknown" }),
    /Unknown project/,
  );
  assert.throws(
    () => deps.authorize({ projectId: "proj_A", conversationId: "unknown" }),
    /Unknown conversation/,
  );
  ctx.bindings.context.metadata = () => ({
    projectId: "proj_B",
    lastSequence: 1,
  });
  assert.throws(
    () => deps.authorize({ projectId: "proj_A", conversationId: "conv_A" }),
    /another project/,
  );
  ctx.bindings.context.metadata = () => ({
    projectId: "proj_A",
    lastSequence: 1,
  });
  await deps.authorize({ projectId: "proj_A", conversationId: "conv_A" });
  await deps.context({ projectId: "proj_A", conversationId: "conv_A" });
  await deps.context({ projectId: "proj_A", conversationId: "conv_A" });
  assert.equal(ctx.historyReads, 1);
});

void test("remote sources merge every discovered repository without losing healthy results on a sibling failure", async () => {
  const ctx = fixture();
  const deps = createCompletionDependencies(ctx.bindings);
  const prs = await deps.providers
    .find((provider) => provider.id === "pull_requests")!
    .load({ projectId: "proj_A" });
  assert.ok("documents" in prs);
  assert.equal(prs.documents.length, 2);
  assert.equal(prs.refreshing, true);
  const issues = await deps.providers
    .find((provider) => provider.id === "issues")!
    .load({ projectId: "proj_A" });
  assert.ok("documents" in issues);
  assert.equal(issues.documents.length, 1);
  assert.notEqual(issues.status, "fresh");
  assert.deepEqual(ctx.visited, [
    "pr:api",
    "pr:docs",
    "issue:api",
    "issue:docs",
  ]);
});

void test("lifecycle notices invalidate only relevant scopes and disposing subscriptions detaches listeners", () => {
  const ctx = fixture();
  const deps = createCompletionDependencies(ctx.bindings);
  const seen: unknown[] = [];
  const stopFiles = deps.providers.find((provider) => provider.id === "files")!
    .subscribe!((scope) => seen.push(scope));
  const stopChildren = deps.providers.find(
    (provider) => provider.id === "subagents",
  )!.subscribe!((scope) => seen.push(scope));
  for (const listener of ctx.notices)
    listener({
      type: "filesystem.project.changed",
      data: { projectId: "proj_A" },
    } as Notice);
  assert.deepEqual(seen, [{ projectId: "proj_A" }]);
  for (const listener of ctx.changes)
    listener({
      kind: "conversation_changed",
      summary: { projectId: "proj_A", parentConversationId: "conv_A" },
    } as CoreChange);
  assert.deepEqual(seen.at(-1), {
    projectId: "proj_A",
    conversationId: "conv_A",
  });
  stopFiles();
  stopChildren();
  assert.equal(ctx.notices.size, 0);
  assert.equal(ctx.changes.size, 0);
});

void test("repositories with unreadable status are still queried; failed remote cannot look fresh", async () => {
  const ctx = fixture();
  const discover = ctx.bindings.git.discoverRepos;
  ctx.bindings.git.discoverRepos = async (projectId) => ({
    ...(await discover(projectId)),
    errors: [
      {
        repo: "broken",
        category: "read",
        message: "Synthetic metadata failure",
        retryable: false,
      },
    ],
  });
  const cached = ctx.bindings.git.cachedOpenPrs;
  const requested: string[] = [];
  ctx.bindings.git.cachedOpenPrs = (projectId, repo) => {
    requested.push(repo);
    if (repo === "broken") throw new Error("Synthetic unavailable remote");
    return cached(projectId, repo);
  };
  const deps = createCompletionDependencies(ctx.bindings);
  const snapshot = await deps.providers
    .find((provider) => provider.id === "pull_requests")!
    .load({ projectId: "proj_A" });
  assert.ok("documents" in snapshot);
  assert.deepEqual(requested, ["api", "docs", "broken"]);
  assert.equal(snapshot.documents.length, 2);
  assert.notEqual(snapshot.status, "fresh");
});

void test("remote settlement invalidates only its source and project; unsubscribe detaches both sources", () => {
  const ctx = fixture();
  const deps = createCompletionDependencies(ctx.bindings);
  const prs: unknown[] = [],
    issues: unknown[] = [];
  const stopPrs = deps.providers.find(
    (provider) => provider.id === "pull_requests",
  )!.subscribe!((scope) => prs.push(scope));
  const stopIssues = deps.providers.find(
    (provider) => provider.id === "issues",
  )!.subscribe!((scope) => issues.push(scope));
  for (const listener of ctx.remoteChanges)
    listener({ projectId: "proj_A", source: "pull_requests" });
  assert.deepEqual(prs, [{ projectId: "proj_A" }]);
  assert.deepEqual(issues, []);
  for (const listener of ctx.remoteChanges)
    listener({ projectId: "proj_B", source: "issues" });
  assert.deepEqual(prs, [{ projectId: "proj_A" }]);
  assert.deepEqual(issues, [{ projectId: "proj_B" }]);
  stopPrs();
  for (const listener of ctx.remoteChanges)
    listener({ projectId: "proj_A", source: "pull_requests" });
  assert.equal(prs.length, 1);
  stopIssues();
  assert.equal(ctx.remoteChanges.size, 0);
  assert.equal(ctx.notices.size, 0);
});

void test("warm failed refresh preserves retained documents and timestamp without false fresh status", async () => {
  const ctx = fixture();
  const cached = ctx.bindings.git.cachedOpenPrs;
  const updatedAt = new Date().toISOString();
  ctx.bindings.git.cachedOpenPrs = (projectId, repo) => ({
    ...cached(projectId, repo),
    status: repo === "docs" ? "stale" : "fresh",
    refreshing: false,
    updatedAt,
  });
  const deps = createCompletionDependencies(ctx.bindings);
  const snapshot = await deps.providers
    .find((provider) => provider.id === "pull_requests")!
    .load({ projectId: "proj_A" });
  assert.ok("documents" in snapshot);
  assert.equal(snapshot.documents.length, 2);
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.refreshing, false);
  assert.equal(snapshot.updatedAt, Date.parse(updatedAt));
});

void test("launch output chunks do not reindex launch documents; lifecycle updates still invalidate", () => {
  const ctx = fixture();
  const deps = createCompletionDependencies(ctx.bindings);
  const seen: unknown[] = [];
  const stop = deps.providers.find((provider) => provider.id === "launches")!
    .subscribe!((scope) => seen.push(scope));
  for (const listener of ctx.notices)
    listener({
      type: "launch.output",
      data: { launch: { projectId: "proj_A" } },
    } as Notice);
  assert.deepEqual(seen, []);
  for (const listener of ctx.notices)
    listener({
      type: "launch.started",
      data: { launch: { projectId: "proj_A" } },
    } as Notice);
  assert.deepEqual(seen, [{ projectId: "proj_A" }]);
  stop();
  assert.equal(ctx.notices.size, 0);
});

void test("filesystem cause hints reach files and access-sensitive catalogs; actual/config changes stay hard", () => {
  const ctx = fixture();
  const deps = createCompletionDependencies(ctx.bindings);
  const seen: { source: string; args: unknown[] }[] = [];
  const stops = ["files", "skills", "tools", "profiles"].map((source) =>
    deps.providers.find((provider) => provider.id === source)!.subscribe!(
      (...args: unknown[]) => seen.push({ source, args }),
    ),
  );
  for (const listener of ctx.notices)
    listener({
      type: "filesystem.project.changed",
      data: { projectId: "proj_A", refreshCause: "uncertain_poll" },
    } as Notice);
  assert.deepEqual(
    seen,
    ["files", "skills", "tools", "profiles"].map((source) => ({
      source,
      args: [{ projectId: "proj_A" }, { refreshCause: "uncertain_poll" }],
    })),
  );
  seen.length = 0;
  for (const listener of ctx.notices)
    listener({
      type: "filesystem.project.changed",
      data: { projectId: "proj_A" },
    } as Notice);
  assert.deepEqual(
    seen,
    ["files", "skills", "tools", "profiles"].map((source) => ({
      source,
      args: [{ projectId: "proj_A" }, undefined],
    })),
  );
  seen.length = 0;
  // Cause hints are only meaningful on filesystem notices, never trust/config updates.
  for (const listener of ctx.notices)
    listener({
      type: "settings.updated",
      data: { refreshCause: "uncertain_poll" },
    } as Notice);
  assert.deepEqual(
    seen,
    ["skills", "tools", "profiles"].map((source) => ({
      source,
      args: [undefined, undefined],
    })),
  );
  stops.forEach((stop) => stop());
  assert.equal(ctx.notices.size, 0);
});

void test("deferred stale discovery remains stale for PR/issues even with no repositories", async () => {
  for (const source of ["pull_requests", "issues"]) {
    const ctx = fixture();
    let finish!: (
      value: Awaited<
        ReturnType<CompletionRuntimeBindings["git"]["discoverRepos"]>
      >,
    ) => void;
    ctx.bindings.git.discoverRepos = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const deps = createCompletionDependencies(ctx.bindings);
    const pending = deps.providers
      .find((provider) => provider.id === source)!
      .load({ projectId: "proj_A" });
    assert.deepEqual(ctx.visited, []);
    finish({ projectIsRepo: false, repos: [], stale: true });
    const snapshot = await pending;
    assert.ok("documents" in snapshot);
    assert.deepEqual(snapshot.documents, []);
    assert.equal(snapshot.status, "stale", source);
    assert.equal(snapshot.refreshing, false);
  }
});

void test("deferred stale discovery cannot be upgraded by fresh PR/issue siblings", async () => {
  for (const source of ["pull_requests", "issues"]) {
    const ctx = fixture();
    const discover = ctx.bindings.git.discoverRepos;
    const discovery = await discover("proj_A");
    let finish!: (value: typeof discovery) => void;
    ctx.bindings.git.discoverRepos = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const cachedPrs = ctx.bindings.git.cachedOpenPrs;
    ctx.bindings.git.cachedOpenPrs = (projectId, repo) => ({
      ...cachedPrs(projectId, repo),
      status: "fresh",
      refreshing: false,
      updatedAt: new Date().toISOString(),
    });
    const cachedIssues = ctx.bindings.git.listIssues;
    ctx.bindings.git.listIssues = (projectId) => ({
      ...cachedIssues(projectId, "api"),
      status: "fresh",
      refreshing: false,
      updatedAt: new Date().toISOString(),
    });
    const deps = createCompletionDependencies(ctx.bindings);
    const pending = deps.providers
      .find((provider) => provider.id === source)!
      .load({ projectId: "proj_A" });
    assert.deepEqual(ctx.visited, []);
    finish({ ...discovery, stale: true });
    const snapshot = await pending;
    assert.ok("documents" in snapshot);
    assert.ok(snapshot.documents.length > 0);
    assert.equal(snapshot.status, "stale", source);
    assert.equal(snapshot.refreshing, false);
  }
});
