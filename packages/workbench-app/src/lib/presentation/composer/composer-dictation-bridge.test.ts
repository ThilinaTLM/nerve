import assert from "node:assert/strict";
import { test } from "node:test";
import { ComposerDictationBridge } from "./composer-dictation-bridge";
import type {
  ComposerDictationHandle,
  ComposerDictationState,
} from "./composer-editor-api";

function chipHarness() {
  const log: string[] = [];
  let removed: (() => void) | undefined;
  let active = true;
  const handle: ComposerDictationHandle = {
    update: (state: ComposerDictationState, ms: number) =>
      log.push(`${state}:${ms}`),
    resolve: (text) => {
      active = false;
      log.push(`resolve:${text}`);
    },
    cancel: () => {
      active = false;
      log.push("cancel");
    },
    get active() {
      return active;
    },
    onRemoved: (listener) => {
      removed = listener;
      return () => {
        removed = undefined;
      };
    },
  };
  let started = 0;
  let cancelled = 0;
  const bridge = new ComposerDictationBridge(
    () => ({
      insertReferences: () => {},
      startDictation: () => {
        started += 1;
        active = true;
        return handle;
      },
    }),
    () => {
      cancelled += 1;
    },
  );
  return {
    bridge,
    log,
    remove: () => {
      active = false;
      removed?.();
    },
    get started() {
      return started;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

test("dictation chip follows recording, freezes time while transcribing, then resolves", () => {
  const chip = chipHarness();
  chip.bridge.sync({ recording: true, transcribing: false, elapsedMs: 2000 });
  chip.bridge.sync({ recording: false, transcribing: true, elapsedMs: 0 });
  assert.equal(chip.bridge.resolve("  hello "), true);
  chip.bridge.sync({ recording: false, transcribing: true, elapsedMs: 0 });
  chip.bridge.sync({ recording: false, transcribing: false, elapsedMs: 0 });
  assert.deepEqual(chip.log, [
    "recording:2000",
    "transcribing:2000",
    "resolve:hello",
  ]);
  assert.equal(chip.started, 1);
});

test("cancelled sessions remove the chip; failures keep it for retry", () => {
  const chip = chipHarness();
  chip.bridge.sync({ recording: true, transcribing: false, elapsedMs: 500 });
  chip.bridge.sync({ recording: false, transcribing: false, elapsedMs: 0 });
  assert.equal(chip.log.at(-1), "cancel");

  const failing = chipHarness();
  failing.bridge.sync({ recording: true, transcribing: false, elapsedMs: 900 });
  failing.bridge.sync({ recording: false, transcribing: true, elapsedMs: 0 });
  assert.equal(failing.bridge.fail(), true);
  failing.bridge.sync({ recording: false, transcribing: false, elapsedMs: 0 });
  assert.equal(failing.bridge.failed, true);
  assert.equal(failing.log.at(-1), "failed:900");
  failing.bridge.discard();
  assert.equal(failing.log.at(-1), "cancel");
});

test("deleting the chip cancels the voice session", () => {
  const chip = chipHarness();
  chip.bridge.sync({ recording: true, transcribing: false, elapsedMs: 100 });
  chip.remove();
  assert.equal(chip.cancelled, 1);
  assert.equal(chip.bridge.active, false);
});

test("a failed chip survives transcribing updates until a new recording starts", () => {
  const chip = chipHarness();
  chip.bridge.sync({ recording: true, transcribing: false, elapsedMs: 1200 });
  chip.bridge.sync({ recording: false, transcribing: true, elapsedMs: 0 });
  // The core reports the error while `transcribing` is still true.
  assert.equal(chip.bridge.fail(), true);
  chip.bridge.sync({ recording: false, transcribing: true, elapsedMs: 0 });
  chip.bridge.sync({ recording: false, transcribing: false, elapsedMs: 0 });
  assert.equal(chip.bridge.failed, true);
  assert.equal(chip.log.at(-1), "failed:1200");
  assert.equal(chip.started, 1);
  // Mic retry: a new recording reuses the chip and clears the failure.
  chip.bridge.sync({ recording: true, transcribing: false, elapsedMs: 300 });
  assert.equal(chip.bridge.failed, false);
  assert.equal(chip.log.at(-1), "recording:300");
  assert.equal(chip.started, 1);
});
