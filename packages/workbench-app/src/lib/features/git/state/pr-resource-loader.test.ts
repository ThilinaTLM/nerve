import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { QueryClient } from "@tanstack/query-core";
import type { GithubPrInitial } from "@nervekit/contracts/git";
import { PrResourceLoader } from "./pr-resource-loader.js";
import type { PrResourceState } from "./pr-resource-loader.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function resource<T>(): PrResourceState<T> {
  return { loading: false, refreshing: false };
}
function setup(t: TestContext) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  t.after(() => queryClient.clear());
  const errors: string[] = [];
  const loader = new PrResourceLoader({
    queryClient,
    now: Date.now,
    reportError: (title, details) => errors.push(`${title}: ${details}`),
  });
  return { queryClient, loader, errors };
}
const initial: GithubPrInitial = {
  core: {
    number: 1,
    title: "initial",
    url: "https://github.com/example/repo/pull/1",
    state: "OPEN",
    isDraft: false,
    headRefName: "topic",
    baseRefName: "main",
    headRefOid: "abcdef0",
    baseRefOid: "1234567",
    updatedAt: "2026-09-01",
    createdAt: "2026-09-01",
    author: null,
    commentCount: 0,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
  },
  conversation: { body: "initial body", comments: [], reviews: [] },
  overview: {
    mergeable: null,
    mergeStateStatus: null,
    reviewDecision: null,
    behindBy: null,
    mergedAt: null,
    mergedBy: null,
    mergeCommitOid: null,
    closedAt: null,
    labels: [],
    reviewRequests: [],
    mergeSettings: { allowedMethods: ["merge"] },
  },
};
function initialInput(query: () => Promise<GithubPrInitial>) {
  return {
    key: ["pr", "initial"],
    query,
    staleTime: 60_000,
    core: {
      key: ["pr", "core"],
      resource: resource<GithubPrInitial["core"]>(),
    },
    conversation: {
      key: ["pr", "conversation"],
      resource: resource<GithubPrInitial["conversation"]>(),
    },
    overview: {
      key: ["pr", "overview"],
      resource: resource<GithubPrInitial["overview"]>(),
    },
  };
}

test("hydrates fresh cached resources without a request", async (t) => {
  const { queryClient, loader } = setup(t);
  queryClient.setQueryData(["cached"], "cached value");
  const state = resource<string>();
  let applied = 0;
  await loader.load({
    key: ["cached"],
    resource: state,
    staleTime: 60_000,
    query: async () => {
      throw new Error("unexpected network");
    },
    apply: () => applied++,
  });
  assert.equal(state.data, "cached value");
  assert.equal(applied, 1);
  assert.equal(state.loading, false);
});

test("coalesces in-flight projection, then force refreshes cached data", async (t) => {
  const { loader } = setup(t);
  const pending = deferred<string>();
  const state = resource<string>();
  let calls = 0;
  let projections = 0;
  const input = {
    key: ["core"],
    resource: state,
    staleTime: 60_000,
    query: () => {
      calls++;
      return pending.promise;
    },
    apply: () => projections++,
  };
  const first = loader.load(input);
  const second = loader.load(input);
  assert.equal(state.loading, true);
  pending.resolve("first");
  assert.deepEqual(await Promise.all([first, second]), ["first", "first"]);
  assert.equal(calls, 1);
  assert.equal(projections, 1);
  assert.equal(state.loading, false);
  await loader.load({
    ...input,
    query: async () => "new",
    options: { force: true },
  });
  assert.equal(state.data, "new");
});

for (const firstToFinish of ["initial", "section"] as const) {
  test(`newer section claim wins when ${firstToFinish} finishes first`, async (t) => {
    const { loader, queryClient } = setup(t);
    const bundle = deferred<GithubPrInitial>();
    const section = deferred<GithubPrInitial["core"]>();
    const input = initialInput(() => bundle.promise);
    const loadingInitial = loader.loadInitial(input);
    const loadingCore = loader.load({
      ...input.core,
      query: () => section.promise,
      staleTime: 60_000,
    });
    const newer = { ...initial.core, title: "newer section" };
    if (firstToFinish === "initial") {
      bundle.resolve(initial);
      await loadingInitial;
      section.resolve(newer);
    } else {
      section.resolve(newer);
      await loadingCore;
      bundle.resolve(initial);
    }
    await Promise.all([loadingInitial, loadingCore]);
    assert.deepEqual(input.core.resource.data, newer);
    assert.deepEqual(queryClient.getQueryData(input.core.key), newer);
    assert.deepEqual(input.conversation.resource.data, initial.conversation);
    assert.equal(input.core.resource.loading, false);
  });
}

test("cached initial bundle cannot overwrite a newer section cache", async (t) => {
  const { loader, queryClient } = setup(t);
  const input = initialInput(async () => initial);
  queryClient.setQueryData(input.key, initial, {
    updatedAt: Date.now() - 1000,
  });
  const newer = { ...initial.core, title: "newer cached section" };
  queryClient.setQueryData(input.core.key, newer);
  await loader.loadInitial(input);
  assert.deepEqual(queryClient.getQueryData(input.core.key), newer);
  assert.equal(input.core.resource.data, undefined);
  assert.deepEqual(input.overview.resource.data, initial.overview);
});

for (const cached of [false, true]) {
  test(`silent errors ${cached ? "retain cached data" : "populate empty resource error"} and allow retries`, async (t) => {
    const { loader, errors } = setup(t);
    const state = resource<string>();
    if (cached) state.data = "previous";
    const pending = deferred<string>();
    const input = {
      key: ["error"],
      resource: state,
      staleTime: 0,
      query: () => pending.promise,
      options: { silent: true, criticalErrorTitle: "Load failed" },
    };
    const request = loader.load(input);
    pending.reject(new Error("offline"));
    assert.equal(await request, undefined);
    assert.equal(state.error, cached ? undefined : "offline");
    assert.equal(state.loading, false);
    assert.equal(state.refreshing, false);
    assert.deepEqual(errors, ["Load failed: offline"]);
    await loader.load({ ...input, query: async () => "recovered" });
    assert.equal(state.data, "recovered");
    assert.equal(state.error, undefined);
  });
}

test("initial request failures clear section flags and do not block retries", async (t) => {
  const { loader } = setup(t);
  const input = initialInput(async () => {
    throw new Error("offline");
  });
  assert.equal(await loader.loadInitial(input), undefined);
  for (const section of [input.core, input.conversation, input.overview]) {
    assert.equal(section.resource.error, "offline");
    assert.equal(section.resource.loading, false);
  }
  await loader.loadInitial({ ...input, query: async () => initial });
  assert.deepEqual(input.core.resource.data, initial.core);
  assert.equal(input.core.resource.error, undefined);
});
