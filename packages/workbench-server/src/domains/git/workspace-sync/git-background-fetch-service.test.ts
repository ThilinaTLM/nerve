import assert from "node:assert/strict";
import { test } from "node:test";
import { GitBackgroundFetch } from "./git-background-fetch-service.js";
import {
  BACKGROUND_FETCH_GAP_MS,
  BACKGROUND_FETCH_MIN_MS,
  type FetchCandidate,
} from "./git-background-fetch-policy.js";

const member = (
  group: string,
  repo: string,
  primary = false,
): FetchCandidate => ({
  projectId: "p",
  repo,
  group,
  primary,
});

function fixture(
  candidates: FetchCandidate[],
  results: Array<
    { status: "busy" } | { status: "done"; moved: boolean } | Error
  > = [],
) {
  let now = 0;
  const fetched: string[] = [];
  const moved: FetchCandidate[][] = [];
  let active = 0,
    maxActive = 0;
  const service = new GitBackgroundFetch(
    {
      backgroundFetch: async (_p, repo) => {
        maxActive = Math.max(maxActive, ++active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        fetched.push(repo);
        const result = results.shift() ?? { status: "done", moved: false };
        if (result instanceof Error) throw result;
        return result;
      },
    },
    { candidates: () => candidates },
    (members) => moved.push(members),
    { now: () => now, random: () => 0 },
  );
  return {
    service,
    fetched,
    moved,
    maxActive: () => maxActive,
    at: (value: number) => (now = value),
  };
}
const tick = async (
  context: { mock: { timers: { tick(ms: number): void } } },
  ms: number,
  f: ReturnType<typeof fixture>,
) => {
  context.mock.timers.tick(ms);
  await f.service.idle();
  await new Promise((resolve) => setImmediate(resolve));
  await f.service.idle();
};

void test("fetches once per repository group, serially, and reports moved refs for every worktree", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(
    [
      member("g1", "wt", false),
      member("g1", "main", true),
      member("g2", "other", true),
    ],
    [{ status: "done", moved: true }],
  );
  try {
    f.service.start();
    f.at(0);
    await tick(context, 0, f); // random 0 => first fetch immediately
    assert.deepEqual(f.fetched, ["main"]);
    assert.deepEqual(
      f.moved.map((m) => m.map((c) => c.repo).sort()),
      [["main", "wt"]],
    );
    // The daemon-wide gap keeps the second group waiting.
    await tick(context, BACKGROUND_FETCH_GAP_MS - 1, f);
    f.at(BACKGROUND_FETCH_GAP_MS - 1);
    assert.deepEqual(f.fetched, ["main"]);
    f.at(BACKGROUND_FETCH_GAP_MS);
    await tick(context, 1, f);
    assert.deepEqual(f.fetched, ["main", "other"]);
    assert.equal(f.maxActive(), 1);
    // Not again before the 5 minute minimum.
    f.at(BACKGROUND_FETCH_MIN_MS - 1);
    await tick(context, BACKGROUND_FETCH_MIN_MS - 1, f);
    assert.equal(f.fetched.length, 2);
  } finally {
    await f.service.close();
  }
});

void test("a busy repository is skipped and retried later, a failure backs off", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(
    [member("g1", "main", true)],
    [
      { status: "busy" },
      new Error("offline"),
      { status: "done", moved: false },
    ],
  );
  try {
    f.service.start();
    await tick(context, 0, f);
    assert.equal(f.fetched.length, 1);
    assert.equal(f.moved.length, 0);
    f.at(60_000);
    await tick(context, 60_000, f);
    assert.equal(f.fetched.length, 2, "retried after the busy delay");
    // Failure: next attempt is at least twice the minimum interval away.
    f.at(60_000 + BACKGROUND_FETCH_MIN_MS * 1.5);
    await tick(context, BACKGROUND_FETCH_MIN_MS * 1.5, f);
    assert.equal(f.fetched.length, 2);
    f.at(60_000 + BACKGROUND_FETCH_MIN_MS * 2 + 1);
    await tick(context, BACKGROUND_FETCH_MIN_MS, f);
    assert.equal(f.fetched.length, 3);
  } finally {
    await f.service.close();
  }
});

void test("repositories that are no longer visible are not fetched", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const list = [member("g1", "main", true)];
  let now = 0;
  const fetched: string[] = [];
  const service = new GitBackgroundFetch(
    {
      backgroundFetch: async (_p, repo) => {
        fetched.push(repo);
        return { status: "done", moved: false };
      },
    },
    { candidates: () => list },
    () => undefined,
    { now: () => now, random: () => 0.5 },
  );
  try {
    service.start();
    list.length = 0;
    now = BACKGROUND_FETCH_MIN_MS;
    context.mock.timers.tick(BACKGROUND_FETCH_MIN_MS);
    await service.idle();
    assert.deepEqual(fetched, []);
  } finally {
    await service.close();
  }
});
