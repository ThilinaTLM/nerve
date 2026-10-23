import assert from "node:assert/strict";
import test from "node:test";
import type { ServerLifecycle } from "@nervekit/contracts/status";
import {
  describeLifecycle,
  discardPlan,
  failureKind,
  postLifecycleRetry,
  postLifecycleRollback,
  readyAction,
} from "./server-lifecycle";

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

test("migration phases replace the step description and format large counts", () => {
  const view = describeLifecycle({
    ...base,
    progress: {
      step: "0002-agent-profiles",
      label: "Converting conversation settings",
      done: 312,
      total: 1012,
    },
  });
  assert.equal(
    view.detail,
    `Converting conversation settings · ${Number(312).toLocaleString()} of ${Number(1012).toLocaleString()}`,
  );
  assert.deepEqual(view.meter, {
    done: 312,
    total: 1012,
    fraction: 312 / 1012,
  });
  const backup = describeLifecycle({
    ...base,
    progress: { step: "0002-agent-profiles", label: "Backing up database" },
  });
  assert.equal(backup.detail, "Backing up database");
  assert.equal(backup.meter, undefined);
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

test("failure kind picks the recovery screen", () => {
  const failure = {
    code: "MIGRATION_FAILED",
    message: "boom",
    retryable: true,
  };
  assert.equal(failureKind(failure), "generic");
  assert.equal(failureKind(undefined), "generic");
  assert.equal(
    failureKind({
      ...failure,
      discardable: [{ kind: "conversation", id: "conv_1", reason: "corrupt" }],
    }),
    "discardable",
  );
  assert.equal(
    failureKind({ ...failure, code: "MIGRATION_ROLLED_BACK" }),
    "rolled-back",
  );
});

test("retry sends discard ids only when given; rollback posts no body", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(base), { status: 202 });
  }) as typeof fetch;
  try {
    await postLifecycleRetry();
    await postLifecycleRetry(["conv_1", "conv_2"]);
    await postLifecycleRollback();
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls[0]?.init?.body, undefined);
  assert.equal(
    calls[1]?.init?.body,
    JSON.stringify({ discardIds: ["conv_1", "conv_2"] }),
  );
  assert.equal(calls[2]?.url, "/api/lifecycle/rollback");
  assert.equal(calls[2]?.init?.body, undefined);
});

test("refused recovery requests resolve undefined", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("{}", { status: 409 })) as typeof fetch;
  try {
    assert.equal(await postLifecycleRollback(), undefined);
    assert.equal(await postLifecycleRetry(["x"]), undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("discard plan copy fits files, conversations, and both", () => {
  const file = { kind: "configuration" as const, id: "/a", reason: "bad" };
  const conv = { kind: "conversation" as const, id: "c", reason: "bad" };
  const files = discardPlan([file, { ...file, id: "/b" }]);
  assert.equal(files.heading, "Some settings files couldn't be upgraded");
  assert.equal(files.action, "Set aside 2 files and continue");
  assert.match(files.confirmation, /original data is kept/);
  assert.doesNotMatch(files.confirmation, /deleted/);

  const convs = discardPlan([conv, conv, conv]);
  assert.equal(convs.action, "Set aside 3 conversations and continue");
  assert.match(convs.confirmation, /quarantine/);

  const mixed = discardPlan([file, conv]);
  assert.equal(mixed.action, "Set aside and continue");
  assert.match(mixed.confirmation, /quarantine/);
  assert.equal(mixed.conversations.length, 1);
  assert.equal(mixed.files.length, 1);
});
