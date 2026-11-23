import assert from "node:assert/strict";
import { test } from "node:test";
import {
  call,
  rejects,
  skip,
  useWorldRoot,
  world,
} from "./extension-ui-world.js";

useWorldRoot();

void test(
  "store bridge methods round-trip, report conflicts and carry the frame's origin",
  { skip },
  async () => {
    const w = await world();
    const page = { kind: "page" as const, id: "explorer" };
    const origin = { origin: "frame-1" };
    assert.deepEqual(await call(w, "store.get", page, { key: "a" }), {
      entry: null,
    });
    assert.deepEqual(
      await call(
        w,
        "store.set",
        page,
        { key: "a", value: { n: 1 }, ifRevision: 0 },
        origin,
      ),
      { revision: 1 },
    );
    await rejects(
      call(w, "store.set", page, {
        key: "a",
        value: 2,
        ifRevision: 0,
      }),
      "conflict",
    );
    assert.deepEqual(await call(w, "store.keys", page, {}), {
      keys: [{ key: "a", revision: 1, size: 7 }],
    });
    // The store is per project.
    assert.deepEqual(
      await call(w, "store.get", page, { key: "a" }, { projectId: "p2" }),
      { entry: null },
    );
    await call(w, "store.delete", page, { key: "a" });
    assert.deepEqual(w.changes, [
      {
        extensionId: "ui-probe",
        projectId: "p1",
        key: "a",
        revision: 1,
        origin: "frame-1",
      },
      { extensionId: "ui-probe", projectId: "p1", key: "a", revision: null },
    ]);
  },
);

void test(
  "reportFrameError records active frames' errors and refuses unknown contributions",
  { skip },
  async () => {
    const w = await world();
    const report = (
      contribution: { kind: "preview" | "page" | "panel"; id: string },
      error: {
        kind: "error" | "unhandledrejection" | "csp";
        message: string;
        source?: string;
      },
    ) =>
      w.service.reportFrameError({
        projectId: "p1",
        extensionId: "ui-probe",
        contribution,
        error,
      });
    await report(
      { kind: "page", id: "explorer" },
      {
        kind: "csp",
        message: "blocked fetch",
        source: "connect-src https://x.test/a",
      },
    );
    await report(
      { kind: "preview", id: "table" },
      { kind: "unhandledrejection", message: "nope" },
    );
    const [first, second] = w.catalog.errors.recent("ui-probe");
    assert.equal(first!.operation, "frame:page/explorer");
    assert.equal(first!.code, "CspViolation");
    assert.equal(
      first!.message,
      "blocked fetch (connect-src https://x.test/a)",
    );
    assert.equal(second!.operation, "frame:preview/table");
    assert.equal(second!.code, "UnhandledRejection");
    await rejects(
      report({ kind: "page", id: "missing" }, { kind: "error", message: "x" }),
      "not_found",
    );
    // The kind must match the declared contribution.
    await rejects(
      report(
        { kind: "panel", id: "explorer" },
        { kind: "error", message: "x" },
      ),
      "not_found",
    );
    assert.equal(w.catalog.errors.recent("ui-probe").length, 2);
  },
);
