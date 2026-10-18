import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeOperationError } from "@nervekit/native";
import { runNativeGitProjectRead } from "../../src/git/read/git-native-read-admission.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const capacity = () =>
  new NativeOperationError({
    category: "limit_exceeded",
    retryable: true,
    message: "Native Git capacity is full",
  });

void test("transient monitor capacity is retried without busy spin and resumes after capacity is released", async () => {
  let busy = true;
  let attempts = 0;
  let firstAttempt!: () => void;
  const started = new Promise<void>((resolve) => {
    firstAttempt = resolve;
  });
  const reading = runNativeGitProjectRead(async () => {
    attempts++;
    firstAttempt();
    if (busy) throw capacity();
    return "metadata";
  }, new AbortController().signal);
  await started;
  assert.equal(attempts, 1);
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  assert.equal(attempts, 1, "retry uses a timer, not a microtask/spin loop");
  busy = false;
  assert.equal(await reading, "metadata");
  assert.equal(attempts, 2);
});

void test("capacity retry cancellation is prompt and bounded deadline stops further native attempts", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const reading = runNativeGitProjectRead(async () => {
    attempts++;
    throw capacity();
  }, controller.signal);
  const rejected = assert.rejects(reading, { name: "AbortError" });
  await tick();
  controller.abort();
  await rejected;
  assert.equal(attempts, 1);
  let timedAttempts = 0;
  await assert.rejects(
    runNativeGitProjectRead(
      async () => {
        timedAttempts++;
        throw capacity();
      },
      new AbortController().signal,
      performance.now() + 10,
    ),
    /deadline exceeded/,
  );
  assert.ok(timedAttempts <= 1);
});

void test("nonretryable result overflow and untyped failures are never retried", async () => {
  for (const failure of [
    new NativeOperationError({
      category: "limit_exceeded",
      retryable: false,
      message: "result overflow",
    }),
    new Error("capacity wording is not a typed diagnostic"),
  ]) {
    let calls = 0;
    await assert.rejects(
      runNativeGitProjectRead(async () => {
        calls++;
        throw failure;
      }, new AbortController().signal),
      (error: unknown) => error === failure,
    );
    assert.equal(calls, 1);
  }
});

void test("aborted actual native work retains its scheduler permit until actual completion", async () => {
  let releaseA!: () => void;
  let releaseB!: () => void;
  const controller = new AbortController();
  const a = runNativeGitProjectRead(
    () =>
      new Promise<void>((resolve) => {
        releaseA = resolve;
      }),
    controller.signal,
  );
  const cancelled = assert.rejects(a, { name: "AbortError" });
  const b = runNativeGitProjectRead(
    () =>
      new Promise<void>((resolve) => {
        releaseB = resolve;
      }),
    new AbortController().signal,
  );
  await tick();
  let ran = false;
  const c = runNativeGitProjectRead(async () => {
    ran = true;
  }, new AbortController().signal);
  controller.abort();
  await tick();
  assert.equal(ran, false);
  releaseA();
  await cancelled;
  await c;
  assert.equal(ran, true);
  releaseB();
  await b;
});
