import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import type {
  FileCompletionIndex,
  FileCompletionMatch,
} from "@nervekit/native";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";
import { FileCompletionService } from "../../../src/domains/completions/file-completion-service.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const matches: FileCompletionMatch[] = [
  { candidateIndex: 0, score: 42, matchRanges: [[1, 3]] },
];
function trackedIndex() {
  let closes = 0;
  let queries = 0;
  let active = 0;
  let maximumActive = 0;
  let query: () => Promise<FileCompletionMatch[]> = async () => matches;
  let tail = Promise.resolve();
  const index: FileCompletionIndex = {
    query() {
      // Fake the facade's FIFO, not a second production service queue.
      const work = tail.then(async () => {
        assert.equal(closes, 0, "must not query a closed index");
        queries += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          return await query();
        } finally {
          active -= 1;
        }
      });
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
    async close() {
      assert.equal(active, 0);
      closes += 1;
    },
  };
  return {
    index,
    block: (next: typeof query) => {
      query = next;
    },
    get closes() {
      return closes;
    },
    get queries() {
      return queries;
    },
    get maximumActive() {
      return maximumActive;
    },
  };
}
const candidates = [candidateFromPath("README.md", "file")];
const project = (id = "p", directory = "/synthetic/root"): Project => ({
  id,
  name: id,
  directory,
  createdAt: "",
  updatedAt: "",
});
const services: FileCompletionService[] = [];
function service(
  options: ConstructorParameters<typeof FileCompletionService>[1] = {},
  getProject: (id: string) => Project = () => project(),
) {
  const instance = new FileCompletionService(getProject, {
    discover: async () => candidates,
    createIndex: async () => trackedIndex().index,
    ...options,
  });
  services.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((instance) => instance.dispose()));
});

describe("completion index lifecycle with injected handles", () => {
  for (const stage of ["discovery", "build"] as const) {
    it(`allows awaited callers to finish when disposed during ${stage}, then closes exactly once`, async () => {
      const gate = deferred<void>();
      const queryGate = deferred<FileCompletionMatch[]>();
      const handle = trackedIndex();
      handle.block(() => queryGate.promise);
      let builds = 0;
      const instance = service({
        discover: async () => {
          if (stage === "discovery") await gate.promise;
          return candidates;
        },
        createIndex: async () => {
          builds += 1;
          if (stage === "build") await gate.promise;
          return handle.index;
        },
      });
      const first = instance.completeFiles("p", "read");
      const second = instance.completeFiles("p", "reader");
      await flush();
      let disposed = false;
      const disposal = instance.dispose("p").then(() => {
        disposed = true;
      });
      await flush();
      assert.equal(disposed, false);
      gate.resolve();
      await flush();
      assert.equal(builds, 1);
      assert.equal(handle.queries, 1);
      assert.equal(handle.closes, 0);
      queryGate.resolve(matches);
      assert.equal((await first)[0]?.info, "README.md");
      assert.equal((await second)[0]?.info, "README.md");
      await disposal;
      assert.equal(handle.closes, 1);
      assert.equal(handle.maximumActive, 1);
      await instance.dispose("p");
      assert.equal(handle.closes, 1);
    });
  }

  it(
    "closes global admission synchronously while accepted work drains, and is idempotent",
    { timeout: 5_000 },
    async () => {
      const discovery = deferred<void>();
      const handle = trackedIndex();
      let discoveries = 0;
      let builds = 0;
      const instance = service({
        discover: async () => {
          discoveries += 1;
          await discovery.promise;
          return candidates;
        },
        createIndex: async () => {
          builds += 1;
          return handle.index;
        },
      });
      const accepted = instance.completeFiles("p", "read");
      await flush();
      let disposed = false;
      const firstDisposal = instance.dispose().then(() => {
        disposed = true;
      });
      const repeatedDisposal = instance.dispose();
      try {
        // Check before releasing discovery: shutdown must not admit a new ranked
        // request or a live-listing request that could prewarm another index.
        await assert.rejects(
          instance.completeFiles("new", "read"),
          /service is closed/,
        );
        await assert.rejects(
          instance.completeFiles("p", ""),
          /service is closed/,
        );
        await assert.rejects(
          instance.completeFiles(undefined, "read"),
          /service is closed/,
        );
        assert.equal(discoveries, 1);
        assert.equal(builds, 0);
        assert.equal(disposed, false);
        discovery.resolve();
        assert.equal((await accepted)[0]?.info, "README.md");
        await Promise.all([firstDisposal, repeatedDisposal]);
        assert.equal(handle.queries, 1);
        assert.equal(handle.closes, 1);
        assert.equal(builds, 1);
        await instance.dispose();
        await assert.rejects(
          instance.completeFiles("p", "read"),
          /service is closed/,
        );
        assert.equal(discoveries, 1);
        assert.equal(handle.closes, 1);
      } finally {
        discovery.resolve();
        await Promise.all([accepted, firstDisposal, repeatedDisposal]);
      }
    },
  );

  it("keeps project-specific disposal reusable", async () => {
    const handles: ReturnType<typeof trackedIndex>[] = [];
    const instance = service({
      createIndex: async () => {
        const handle = trackedIndex();
        handles.push(handle);
        return handle.index;
      },
    });
    await instance.completeFiles("p", "read");
    await instance.dispose("p");
    assert.equal(handles[0]?.closes, 1);
    await instance.completeFiles("p", "read");
    assert.equal(handles.length, 2);
    assert.equal(handles[1]?.queries, 1);
    assert.equal(handles[1]?.closes, 0);
  });

  it("awaits a late prewarm build with no query lease before closing it", async () => {
    const build = deferred<FileCompletionIndex>();
    const handle = trackedIndex();
    const instance = service({ createIndex: async () => build.promise });
    // This synthetic root does not exist, so the directory listing is empty,
    // while prewarming still starts discovery/build without a ranked caller.
    assert.deepEqual(await instance.completeFiles("p", ""), []);
    const disposal = instance.dispose("p");
    build.resolve(handle.index);
    await disposal;
    assert.equal(handle.queries, 0);
    assert.equal(handle.closes, 1);
  });

  it("keeps an old snapshot alive across refresh until its active query settles", async () => {
    let now = 0;
    const old = trackedIndex();
    const next = trackedIndex();
    let builds = 0;
    const instance = service({
      now: () => now,
      createIndex: async () => (builds++ === 0 ? old.index : next.index),
    });
    await instance.completeFiles("p", "read");
    const queryGate = deferred<FileCompletionMatch[]>();
    old.block(() => queryGate.promise);
    now = 120_001;
    const stale = instance.completeFiles("p", "read");
    await flush();
    assert.equal(builds, 2);
    assert.equal(old.closes, 0);
    await instance.completeFiles("p", "read");
    assert.equal(next.queries, 1);
    queryGate.resolve(matches);
    await stale;
    await flush();
    assert.equal(old.closes, 1);
    assert.equal(next.closes, 0);
    await instance.dispose();
    assert.equal(next.closes, 1);
  });

  it("keeps stale data after failed refresh and retries without duplicate builds", async () => {
    let now = 0;
    let builds = 0;
    const old = trackedIndex();
    const next = trackedIndex();
    const failure = deferred<FileCompletionIndex>();
    const instance = service({
      now: () => now,
      createIndex: async () => {
        builds += 1;
        if (builds === 1) return old.index;
        if (builds === 2) return failure.promise;
        return next.index;
      },
    });
    await instance.completeFiles("p", "read");
    now = 120_001;
    await Promise.all([
      instance.completeFiles("p", "read"),
      instance.completeFiles("p", "read"),
    ]);
    assert.equal(builds, 2);
    failure.reject(new Error("build failed"));
    await flush();
    assert.equal(old.closes, 0);
    await instance.completeFiles("p", "read");
    await flush();
    assert.equal(builds, 3);
    assert.equal(old.closes, 1);
    await instance.completeFiles("p", "read");
    assert.equal(next.queries, 1);
  });

  it("releases each generation once across repeated expiry and disposal", async () => {
    let now = 0;
    const handles: ReturnType<typeof trackedIndex>[] = [];
    const instance = service({
      now: () => now,
      createIndex: async () => {
        const handle = trackedIndex();
        handles.push(handle);
        return handle.index;
      },
    });
    await instance.completeFiles("p", "read");
    for (let round = 0; round < 3; round += 1) {
      now += 120_001;
      await instance.completeFiles("p", "read");
      await flush();
    }
    assert.deepEqual(
      handles.map((handle) => handle.closes),
      [1, 1, 1, 0],
    );
    await instance.dispose();
    assert.deepEqual(
      handles.map((handle) => handle.closes),
      [1, 1, 1, 1],
    );
  });

  it("reconciles project roots and global disposal includes already retired resources", async () => {
    let root = "/synthetic/first";
    const old = trackedIndex();
    const next = trackedIndex();
    let builds = 0;
    const instance = service(
      { createIndex: async () => (builds++ === 0 ? old.index : next.index) },
      () => project("p", root),
    );
    await instance.completeFiles("p", "read");
    const gate = deferred<FileCompletionMatch[]>();
    old.block(() => gate.promise);
    const pending = instance.completeFiles("p", "read");
    await flush();
    root = "/synthetic/second";
    await instance.completeFiles("p", "read");
    assert.equal(old.closes, 0);
    let disposed = false;
    const disposal = instance.dispose().then(() => {
      disposed = true;
    });
    await flush();
    assert.equal(disposed, false);
    assert.equal(next.closes, 1);
    gate.resolve(matches);
    await pending;
    await disposal;
    assert.equal(old.closes, 1);
  });

  it("LRU eviction closes idle handles but preserves active leases", async () => {
    const handles = new Map<string, ReturnType<typeof trackedIndex>>();
    const instance = service(
      {
        maxCachedProjects: 2,
        discover: async (root) => [
          candidateFromPath(`${root.split("/").at(-1)}.ts`, "file"),
        ],
        createIndex: async (input) => {
          const handle = trackedIndex();
          handles.set(input[0]!.name, handle);
          return handle.index;
        },
      },
      (id) => project(id, `/synthetic/${id}`),
    );
    await instance.completeFiles("a", "read");
    await instance.completeFiles("b", "read");
    const a = handles.get("a.ts")!;
    const gate = deferred<FileCompletionMatch[]>();
    a.block(() => gate.promise);
    const pending = instance.completeFiles("a", "read");
    await flush(); // a is MRU
    await instance.completeFiles("c", "read");
    await flush();
    assert.equal(handles.get("b.ts")!.closes, 1);
    assert.equal(a.closes, 0);
    await instance.completeFiles("c", "read");
    await instance.completeFiles("d", "read");
    await flush(); // a evicted, still leased
    assert.equal(a.closes, 0);
    gate.resolve(matches);
    await pending;
    await flush();
    assert.equal(a.closes, 1);
    await instance.dispose();
    for (const handle of handles.values()) assert.equal(handle.closes, 1);
  });

  it("does not install a late build evicted by LRU", async () => {
    const gate = deferred<FileCompletionIndex>();
    const late = trackedIndex();
    let builds = 0;
    const instance = service(
      {
        maxCachedProjects: 1,
        createIndex: async () =>
          ++builds === 1 ? gate.promise : trackedIndex().index,
      },
      (id) => project(id),
    );
    const pending = instance.completeFiles("a", "read");
    await flush();
    await instance.completeFiles("b", "read");
    gate.resolve(late.index);
    await pending;
    await flush();
    assert.equal(late.closes, 1);
    await instance.completeFiles("a", "read");
    assert.equal(builds, 3);
  });

  it("bounds cold requests and serializes accepted calls without native busy errors", async () => {
    const gate = deferred<FileCompletionIndex>();
    const handle = trackedIndex();
    handle.block(async () => {
      await flush();
      return matches;
    });
    let builds = 0;
    const instance = service({
      createIndex: async () => {
        builds += 1;
        return gate.promise;
      },
    });
    const pending = Array.from({ length: 32 }, () =>
      instance.completeFiles("p", "read"),
    );
    await assert.rejects(
      instance.completeFiles("p", "read"),
      /Too many pending/,
    );
    gate.resolve(handle.index);
    await Promise.all(pending);
    assert.equal(builds, 1);
    assert.equal(handle.queries, 32);
    assert.equal(handle.maximumActive, 1);
    await instance.completeFiles("p", "read");
    assert.equal(handle.queries, 33);
  });

  it("recovers from initial build and queued query failures", async () => {
    const handle = trackedIndex();
    let builds = 0;
    const instance = service({
      createIndex: async () => {
        if (++builds === 1) throw new Error("build failed");
        return handle.index;
      },
    });
    await assert.rejects(instance.completeFiles("p", "read"), /build failed/);
    await instance.completeFiles("p", "read");
    let calls = 0;
    handle.block(async () => {
      if (++calls === 1) throw new Error("query failed");
      return matches;
    });
    const failed = instance.completeFiles("p", "read");
    const queued = instance.completeFiles("p", "read");
    await assert.rejects(failed, /query failed/);
    await queued;
    assert.equal(builds, 2);
    assert.equal(handle.maximumActive, 1);
    await instance.dispose();
    assert.equal(handle.closes, 1);
  });

  it("bounds discovery/build admission across eviction and root changes, then recovers after overflow", async () => {
    let root = 0;
    let activeDiscovery = 0;
    let maximumDiscovery = 0;
    const gates = Array.from({ length: 18 }, () => deferred<void>());
    const handles: ReturnType<typeof trackedIndex>[] = [];
    const started: string[] = [];
    const instance = service(
      {
        maxCachedProjects: 1,
        discover: async (directory) => {
          started.push(directory);
          activeDiscovery += 1;
          maximumDiscovery = Math.max(maximumDiscovery, activeDiscovery);
          try {
            await gates[Number(directory.split("/").at(-1))]?.promise;
            return candidates;
          } finally {
            activeDiscovery -= 1;
          }
        },
        createIndex: async () => {
          const handle = trackedIndex();
          handles.push(handle);
          return handle.index;
        },
      },
      (id) => project(id, `/synthetic/${root}`),
    );
    const pending = [];
    for (root = 0; root < 18; root += 1) {
      pending.push(
        instance.completeFiles(
          root % 2 === 0 ? "rotating" : `project-${root}`,
          "read",
        ),
      );
    }
    assert.equal(started.length, 2);
    await assert.rejects(
      instance.completeFiles("overflow", "read"),
      /Too many pending completion refreshes/,
    );
    let disposed = false;
    // Retire these projects without globally closing admission: this test also
    // verifies recovery after overflow. Global terminal shutdown is tested above.
    const projectIds = new Set(
      Array.from({ length: 18 }, (_, index) =>
        index % 2 === 0 ? "rotating" : `project-${index}`,
      ),
    );
    const disposal = Promise.all(
      [...projectIds].map((id) => instance.dispose(id)),
    ).then(() => {
      disposed = true;
    });
    await flush();
    assert.equal(disposed, false);
    assert.equal(started.length, 2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await flush();
    assert.equal(started.length, 4);
    assert.equal(maximumDiscovery, 2);
    for (const gate of gates) gate.resolve();
    await Promise.all(pending);
    await disposal;
    assert.equal(started.length, 18);
    assert.equal(handles.length, 18);
    assert.ok(handles.every((handle) => handle.closes === 1));
    root = 19;
    await instance.completeFiles("recovered", "read");
    await instance.dispose();
    assert.equal(handles[18]!.closes, 1);
  });

  it("normalizes useful internal limits but rejects unbounded negative slicing", async () => {
    const observed: number[] = [];
    const instance = service({
      createIndex: async () => ({
        async query(_query, options) {
          observed.push(options?.limit ?? -1);
          return matches;
        },
        async close() {},
      }),
    });
    for (const limit of [0, NaN, -Infinity])
      assert.deepEqual(
        await instance.completeFiles("p", "read", { limit }),
        [],
      );
    await instance.completeFiles("p", "read", { limit: 2.9 });
    await instance.completeFiles("p", "read", { limit: Infinity });
    assert.deepEqual(observed, [2, 8]);
    await assert.rejects(
      instance.completeFiles("p", "read", { limit: -1 }),
      RangeError,
    );
  });
});
