import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitProjectReader } from "../../src/git/project-client.js";
import {
  NativeOperationError,
  normalizeNativeError,
} from "../../src/core/error.js";
import type {
  NativeGitProjectBinding,
  NativeGitProjectRepository,
} from "../../src/git/project-contracts.js";

function fixture(overrides: Partial<NativeGitProjectBinding> = {}) {
  const calls: string[] = [];
  const port: NativeGitProjectBinding = {
    createGitReadOperation() {
      calls.push("create");
      return { handle: 1 };
    },
    cancelGitReadOperation() {
      calls.push("cancel");
    },
    closeGitReadOperation() {
      calls.push("close");
    },
    async discoverGitRepositories(root) {
      return { discovery: { root, projectIsRepo: false, repositories: [] } };
    },
    async readGitProjectSnapshots() {
      return { repositories: [] };
    },
    ...overrides,
  };
  return { reader: createGitProjectReader(port), calls };
}

test("shared errors retain category/message/explicit retryability", () => {
  const error = normalizeNativeError({
    category: "io",
    message: "read failed",
    retryable: false,
  });
  assert.ok(error instanceof NativeOperationError);
  assert.equal(error.message, "read failed");
  assert.equal(error.category, "io");
  assert.equal(error.retryable, false);
});
test("isolation diagnostic survives shared normalization independently of message text", () => {
  const error = normalizeNativeError({
    category: "isolation_required",
    message: "Wording may change",
    retryable: false,
  });
  assert.ok(error instanceof NativeOperationError);
  assert.equal(error.category, "isolation_required");
  assert.equal(error.retryable, false);
});
test("pre-aborted reads never acquire native resources", async () => {
  const { reader, calls } = fixture();
  await assert.rejects(
    reader.discoverGitRepositories("/synthetic", {
      signal: AbortSignal.abort(),
    }),
    { category: "cancelled" },
  );
  assert.deepEqual(calls, []);
});
test("cancellation signals native work and waits for its completion before close", async () => {
  let finish!: () => void;
  const { reader, calls } = fixture({
    async discoverGitRepositories() {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        discovery: {
          root: "/synthetic",
          projectIsRepo: false,
          repositories: [],
        },
      };
    },
  });
  const abort = new AbortController();
  const pending = reader.discoverGitRepositories("/synthetic", {
    signal: abort.signal,
  });
  abort.abort();
  assert.deepEqual(calls, ["create", "cancel"]);
  finish();
  await assert.rejects(pending, { category: "cancelled" });
  assert.deepEqual(calls, ["create", "cancel", "close"]);
  abort.abort();
  assert.equal(calls.length, 3);
});
test("admission failures expose retryability without creating a task", async () => {
  const { reader, calls } = fixture({
    createGitReadOperation() {
      return {
        error: { category: "limit_exceeded", message: "busy", retryable: true },
      };
    },
  });
  await assert.rejects(reader.discoverGitRepositories("/synthetic"), {
    category: "limit_exceeded",
    retryable: true,
  });
  assert.deepEqual(calls, []);
});
test("native failures and empty results always close handles", async () => {
  for (const failure of [
    { error: { category: "io" as const, message: "failed", retryable: false } },
    {},
  ]) {
    const { reader, calls } = fixture({
      async discoverGitRepositories() {
        return failure;
      },
    });
    await assert.rejects(
      reader.discoverGitRepositories("/synthetic"),
      NativeOperationError,
    );
    assert.deepEqual(calls, ["create", "close"]);
  }
});
test("synchronous raw binding failures release admission", async () => {
  const { reader, calls } = fixture({
    discoverGitRepositories() {
      throw new Error("raw failure");
    },
  });
  await assert.rejects(reader.discoverGitRepositories("/synthetic"), {
    category: "internal",
    retryable: false,
  });
  assert.deepEqual(calls, ["create", "close"]);
});
test("oversized inputs fail before crossing N-API", async () => {
  const { reader, calls } = fixture();
  await assert.rejects(reader.discoverGitRepositories("x".repeat(4097)), {
    category: "invalid_input",
  });
  await assert.rejects(
    reader.readGitProjectSnapshots(new Array<NativeGitProjectRepository>(129)),
    { category: "invalid_input" },
  );
  assert.deepEqual(calls, []);
});
test("per-repository failures do not hide successful siblings", async () => {
  const repository = {
    relativePath: ".",
    workDir: "/synthetic",
    gitDir: "/synthetic/.git",
    commonDir: "/synthetic/.git",
  };
  const results = [
    {
      repository,
      error: { category: "corrupt" as const, message: "bad", retryable: false },
    },
  ];
  const { reader, calls } = fixture({
    async readGitProjectSnapshots() {
      return { repositories: results };
    },
  });
  assert.deepEqual(await reader.readGitProjectSnapshots([repository]), results);
  assert.deepEqual(calls, ["create", "close"]);
});
