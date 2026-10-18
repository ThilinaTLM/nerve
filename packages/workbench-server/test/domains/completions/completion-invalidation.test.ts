import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CompletionDocument,
  CompletionInvalidate,
} from "../../../src/domains/completions/completion-provider.js";
import {
  deferred,
  doc,
  fakeIndex,
  fixture,
  flush,
  request,
} from "./completion-service-fixture.js";

void test(
  "35s read survives uncertain polls at10/20/30, returns stale and coalesces one demanded follow-up; idle polls never retry forever",
  { timeout: 2000 },
  async () => {
    let now = 0,
      loads = 0;
    let invalidate: CompletionInvalidate = () => {
      throw new Error("Not subscribed");
    };
    const first = deferred<CompletionDocument[]>(),
      followup = deferred<CompletionDocument[]>(),
      later = deferred<CompletionDocument[]>();
    const started = deferred<void>();
    const f = await fixture(
      [
        {
          id: "files",
          ttlMs: 1000,
          subscribe(callback) {
            invalidate = callback;
            return () => {};
          },
          load() {
            loads++;
            started.resolve();
            return loads === 1
              ? first.promise
              : loads === 2
                ? followup.promise
                : later.promise;
          },
        },
      ],
      { now: () => now },
    );
    try {
      const pending = f.service.search(request);
      await started.promise;
      for (const clock of [10_000, 20_000, 30_000]) {
        now = clock;
        invalidate(undefined, { refreshCause: "uncertain_poll" });
        await flush();
        assert.equal(loads, 1);
      }
      now = 35_000;
      first.resolve([doc("useful", { version: "v1" })]);
      const result = await pending;
      assert.equal(
        result.items[0]?.version,
        "v1",
        "poll uncertainty cannot discard the useful active generation",
      );
      assert.equal(result.sources[0]?.status, "stale");
      assert.equal(
        result.sources[0]?.updatedAt,
        undefined,
        "uncertain work cannot invent a fresh timestamp",
      );
      assert.equal(
        loads,
        2,
        "three uncertain polls produce one coalesced follow-up for active demand",
      );
      now = 45_000;
      invalidate(undefined, { refreshCause: "uncertain_poll" });
      now = 70_000;
      followup.resolve([doc("useful", { version: "v2" })]);
      await flush();
      await flush();
      assert.equal(
        loads,
        2,
        "no active demand remains, so no repeated background follow-up",
      );
      now = 80_000;
      invalidate(undefined, { refreshCause: "uncertain_poll" });
      await flush();
      assert.equal(
        loads,
        2,
        "idle uncertain poll marks stale without acquisition",
      );
      const demand = await f.service.search(request);
      assert.equal(demand.items[0]?.version, "v2");
      assert.equal(demand.sources[0]?.status, "stale");
      assert.equal(demand.sources[0]?.updatedAt, undefined);
      assert.equal(loads, 3, "new demand can acquire one fresh revalidation");
      later.resolve([doc("useful", { version: "v3" })]);
      await flush();
    } finally {
      first.resolve([]);
      followup.resolve([]);
      later.resolve([]);
      await f.close();
    }
  },
);

void test(
  "hard config/trust invalidation revokes eligibility during an uncertain read and rejects stale selection",
  { timeout: 2000 },
  async () => {
    let now = 0,
      loads = 0,
      revoked = false,
      writes = 0;
    let invalidate: CompletionInvalidate = () => {};
    const slow = deferred<CompletionDocument[]>(),
      started = deferred<void>();
    const skill = doc("skill", {
      kind: "skill",
      version: "v1",
      item: {
        kind: "skill",
        label: "@skill:session",
        available: true,
        enabled: false,
      },
      setEnabled: async () => {
        writes++;
      },
    });
    const f = await fixture(
      [
        {
          id: "skills",
          accessSensitive: true,
          ttlMs: 1000,
          subscribe(callback) {
            invalidate = callback;
            return () => {};
          },
          load() {
            loads++;
            if (revoked) return Promise.resolve([]);
            if (loads === 1) return Promise.resolve([skill]);
            started.resolve();
            return slow.promise;
          },
        },
      ],
      { now: () => now },
    );
    try {
      const issued = (await f.service.search(request)).items[0]!;
      now = 10_000;
      invalidate(undefined, { refreshCause: "uncertain_poll" });
      const pending = f.service.search(request);
      await started.promise;
      revoked = true;
      invalidate();
      await flush();
      assert.equal(
        f.native.documents.has("skill"),
        false,
        "hard invalidation revokes installed access-sensitive metadata immediately",
      );
      await assert.rejects(
        f.service.select({
          projectId: "p",
          documentId: issued.documentId!,
          expectedVersion: issued.version!,
          action: "select",
        }),
        /changed/,
      );
      assert.equal(writes, 0);
      now = 35_000;
      slow.resolve([{ ...skill, version: "v2" }]);
      assert.deepEqual(
        (await pending).items,
        [],
        "hard-superseded generation cannot restore revoked eligibility",
      );
    } finally {
      slow.resolve([]);
      await f.close();
    }
  },
);

void test(
  "shutdown awaits native close and prevents uncertain follow-ups after retirement",
  { timeout: 2000 },
  async () => {
    const native = fakeIndex(),
      closeStarted = deferred<void>(),
      closeRelease = deferred<void>();
    const close = native.index.close.bind(native.index);
    native.index.close = async () => {
      closeStarted.resolve();
      await closeRelease.promise;
      await close();
    };
    let invalidate: CompletionInvalidate = () => {},
      loads = 0;
    const f = await fixture(
      [
        {
          id: "files",
          ttlMs: 1000,
          subscribe(callback) {
            invalidate = callback;
            return () => {};
          },
          load: async () => {
            loads++;
            return [doc("file")];
          },
        },
      ],
      { createIndex: async () => native.index },
    );
    try {
      await f.service.search(request);
      let disposed = false;
      const disposal = f.service.dispose().then(() => {
        disposed = true;
      });
      await closeStarted.promise;
      invalidate(undefined, { refreshCause: "uncertain_poll" });
      await flush();
      assert.equal(disposed, false);
      assert.equal(loads, 1);
      closeRelease.resolve();
      await disposal;
      assert.equal(native.closed, 1);
    } finally {
      closeRelease.resolve();
      await f.close();
    }
  },
);
