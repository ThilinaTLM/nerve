import assert from "node:assert/strict";
import test from "node:test";
import type { ServerLifecycle } from "@nervekit/contracts/status";
import { describeLifecycle, readyAction } from "./server-lifecycle";

const base: ServerLifecycle = {
  state: "upgrading",
  version: "1.0.0",
  startedAt: "2026-01-01T00:00:00Z",
  message: "Upgrading local storage",
};

test("unreachable server shows the default message", () => {
  assert.deepEqual(describeLifecycle(undefined), { status: "Starting Nerve" });
});

test("known totals give a determinate meter and detail", () => {
  const view = describeLifecycle({
    ...base,
    progress: { step: "0001", label: "Importing", done: 3, total: 12 },
  });
  assert.equal(view.status, "Upgrading local storage");
  assert.equal(view.detail, "Importing · 3 of 12");
  assert.equal(view.meter?.fraction, 0.25);
});

test("unknown totals stay indeterminate", () => {
  const view = describeLifecycle({
    ...base,
    progress: { step: "0001", label: "Importing", done: 3 },
  });
  assert.equal(view.detail, "Importing");
  assert.equal(view.meter, undefined);
});

test("reload only when the server version changed", () => {
  const ready = { ...base, state: "ready" as const };
  assert.equal(readyAction("0.9.0", ready), "reload");
  assert.equal(
    readyAction("1.0.0", { ...ready, startedAt: "later" }),
    "resume",
  );
  assert.equal(readyAction(undefined, ready), "resume");
});
