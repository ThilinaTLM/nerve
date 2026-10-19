import assert from "node:assert/strict";
import { test } from "node:test";
import { shutdownRuntimeResources } from "./shutdown-runtime-resources.js";

void test("shutdown awaits Git and completion users before closing dependencies", async () => {
  const order: string[] = [];
  let releaseGit!: () => void;
  let releaseCompletion!: () => void;
  const git = new Promise<void>((resolve) => {
    releaseGit = resolve;
  });
  const completion = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  const closing = shutdownRuntimeResources({
    gitOperations: {
      close: async () => {
        order.push("git");
        await git;
        order.push("git drained");
      },
    },
    completions: {
      dispose: async () => {
        order.push("completion");
        await completion;
        order.push("completion drained");
      },
    },
    workspaceMonitor: {
      close: async () => {
        order.push("monitor");
      },
    },
    launches: {
      shutdown: async () => {
        order.push("launches");
      },
    },
    conversationCore: {
      close: async () => {
        order.push("core");
      },
    },
  });
  assert.deepEqual(order, ["git"]);
  releaseGit();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["git", "git drained", "completion"]);
  releaseCompletion();
  await closing;
  assert.deepEqual(order, [
    "git",
    "git drained",
    "completion",
    "completion drained",
    "monitor",
    "launches",
    "core",
  ]);
});

void test("rejected producer drains fully settle in order and every later cleanup is attempted", async () => {
  const order: string[] = [];
  const failures = ["git", "completion", "monitor", "launches", "core"].map(
    (name) => new Error(name),
  );
  let rejectGit!: (error: Error) => void;
  let rejectCompletion!: (error: Error) => void;
  const git = new Promise<void>((_resolve, reject) => {
    rejectGit = reject;
  });
  const completion = new Promise<void>((_resolve, reject) => {
    rejectCompletion = reject;
  });
  const outcome = shutdownRuntimeResources({
    gitOperations: {
      close: async () => {
        order.push("git");
        await git;
      },
    },
    completions: {
      dispose: async () => {
        order.push("completion");
        await completion;
      },
    },
    workspaceMonitor: {
      close: () => {
        order.push("monitor");
        throw failures[2];
      },
    },
    launches: {
      shutdown: async () => {
        order.push("launches");
        throw failures[3];
      },
    },
    conversationCore: {
      close: async () => {
        order.push("core");
        throw failures[4];
      },
    },
  }).catch((error: unknown) => error);
  assert.deepEqual(order, ["git"]);
  rejectGit(failures[0]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["git", "completion"]);
  rejectCompletion(failures[1]);
  const error = await outcome;
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, failures);
  assert.deepEqual(order, ["git", "completion", "monitor", "launches", "core"]);
});
