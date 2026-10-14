import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abortableDelay,
  createTranscriptionState,
  TranscriptionOperation,
  type TranscriptionRecorder,
  type TranscriptionCallbacks,
} from "./transcription-operation";
import { VoiceInputSessionCore } from "./voice-input-session-core";
import type { WavRecordingResult } from "./wav-recorder";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const accepted: WavRecordingResult = {
  status: "accepted",
  blob: new Blob(["audio"]),
  durationMs: 400,
  mimeType: "audio/wav",
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const state = createTranscriptionState();
  const transcripts: string[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];
  const recorders: TranscriptionRecorder[] = [];
  let cancelled = 0;
  let sent = 0;
  const dependencies = {
    createRecorder: (): TranscriptionRecorder =>
      recorders.shift() ?? {
        start: async () => {},
        stop: async () => accepted,
        cancel: async () => {
          cancelled += 1;
        },
      },
    isSupported: () => true,
    transcribe: (async () => {
      sent += 1;
      return "hello";
    }) as (
      blob: Blob,
      duration: number,
      signal: AbortSignal,
    ) => Promise<string>,
    isRetryable: () => true,
    maxDurationMs: 480_000,
    maxRetries: 3,
    delay: abortableDelay,
  };
  const callbacks: TranscriptionCallbacks = {
    onTranscript: (text: string) => {
      transcripts.push(text);
    },
    onError: (message: string) => {
      errors.push(message);
    },
    onSkipped: (reason: "no-activity" | "too-short") => {
      skipped.push(reason);
    },
  };
  const operation = new TranscriptionOperation(state, dependencies, callbacks);
  return {
    state,
    operation,
    dependencies,
    callbacks,
    recorders,
    transcripts,
    errors,
    skipped,
    get sent() {
      return sent;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

for (const reason of ["no-activity", "too-short"] as const) {
  test(`skip ${reason} never uploads, retries, or reports an error`, async () => {
    const f = fixture();
    f.recorders.push({
      start: async () => {},
      stop: async () => ({ status: "skipped", reason }),
      cancel: async () => {},
    });
    await f.operation.start();
    assert.equal(await f.operation.stop(), false);
    assert.equal(f.sent, 0);
    assert.deepEqual(f.transcripts, []);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.skipped, [reason]);
    assert.equal(f.state.retryAttempt, 0);
    assert.equal(f.operation.pending, false);
    await f.operation.cancel();
  });
}

test("cancel during permission releases late recorder and cannot clear a newer start", async () => {
  const f = fixture();
  const oldStart = deferred<void>();
  const newStart = deferred<void>();
  let released = 0;
  f.recorders.push({
    start: () => oldStart.promise,
    stop: async () => accepted,
    cancel: async () => {
      released += 1;
    },
  });
  f.recorders.push({
    start: () => newStart.promise,
    stop: async () => accepted,
    cancel: async () => {},
  });
  const old = f.operation.start();
  await f.operation.cancel();
  const current = f.operation.start();
  oldStart.resolve();
  await old;
  assert.equal(released, 1);
  assert.equal(f.state.starting, true);
  assert.equal(f.state.recording, false);
  newStart.resolve();
  await current;
  assert.equal(f.state.recording, true);
  await f.operation.cancel();
});

test("a canceled permission failure cannot notify or mutate a newer operation", async () => {
  const f = fixture();
  const permission = deferred<void>();
  f.recorders.push({
    start: () => permission.promise,
    stop: async () => accepted,
    cancel: async () => {},
  });
  const old = f.operation.start();
  await f.operation.cancel();
  await f.operation.start();
  permission.reject(new Error("permission denied"));
  await old;
  assert.equal(f.state.recording, true);
  assert.deepEqual(f.errors, []);
  await f.operation.cancel();
});

test("cancel during recorder stop prevents upload and old finally leaves new state alone", async () => {
  const f = fixture();
  const stopped = deferred<WavRecordingResult>();
  f.recorders.push({
    start: async () => {},
    stop: () => stopped.promise,
    cancel: async () => {},
  });
  await f.operation.start();
  const old = f.operation.stop();
  await f.operation.cancel();
  await f.operation.start();
  stopped.resolve(accepted);
  assert.equal(await old, false);
  assert.equal(f.sent, 0);
  assert.equal(f.state.recording, true);
  assert.equal(f.state.stopping, false);
  await f.operation.cancel();
});

test("cancel aborts fetch; ignored late transcript/finally cannot reset new upload", async () => {
  const f = fixture();
  const oldResult = deferred<string>();
  const newResult = deferred<string>();
  const signals: AbortSignal[] = [];
  f.dependencies.transcribe = (_blob, _duration, signal) => {
    signals.push(signal);
    return signals.length === 1 ? oldResult.promise : newResult.promise;
  };
  await f.operation.start();
  const old = f.operation.stop();
  await tick();
  await f.operation.cancel();
  assert.equal(signals[0].aborted, true);
  await f.operation.start();
  const current = f.operation.stop();
  await tick();
  oldResult.resolve("stale");
  assert.equal(await old, false);
  assert.equal(f.state.transcribing, true);
  assert.equal(f.state.stopping, true);
  assert.deepEqual(f.transcripts, []);
  newResult.resolve("fresh");
  assert.equal(await current, true);
  assert.deepEqual(f.transcripts, ["fresh"]);
  assert.equal(f.operation.pending, false);
  await f.operation.cancel();
});

test("cancel during retry aborts delay and does not dispatch another request", async () => {
  const f = fixture();
  let sends = 0;
  f.dependencies.transcribe = async () => {
    sends += 1;
    throw new Error("offline");
  };
  await f.operation.start();
  const stopping = f.operation.stop();
  await tick();
  assert.equal(f.state.retryAttempt, 1);
  await f.operation.cancel();
  assert.equal(await stopping, false);
  assert.equal(sends, 1);
  assert.deepEqual(f.errors, []);
  assert.equal(f.state.retryAttempt, 0);
});

test("retry delay removes abort listeners on both resolution and cancellation", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const signal = controller.signal;
    let listeners = 0;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args: Parameters<typeof add>) => {
      listeners += 1;
      add(...args);
    };
    signal.removeEventListener = (...args: Parameters<typeof remove>) => {
      listeners -= 1;
      remove(...args);
    };
    const waiting = abortableDelay(cancel ? 10_000 : 0, signal);
    if (cancel) {
      controller.abort();
      await assert.rejects(waiting, { name: "AbortError" });
    } else await waiting;
    assert.equal(listeners, 0);
  }
});

function sessionFixture(maxDurationMs = 480_000) {
  const f = fixture();
  f.dependencies.maxDurationMs = maxDurationMs;
  const notices: string[] = [];
  const session = new VoiceInputSessionCore(
    { activeTarget: undefined, starting: false },
    {
      createController: (callbacks) => {
        Object.assign(f.callbacks, callbacks);
        return {
          get recording() {
            return f.state.recording;
          },
          get transcribing() {
            return f.state.transcribing;
          },
          get pending() {
            return f.operation.pending;
          },
          get elapsedMs() {
            return f.state.elapsedMs;
          },
          get retryAttempt() {
            return f.state.retryAttempt;
          },
          maxDurationMs: f.dependencies.maxDurationMs,
          maxRetries: f.dependencies.maxRetries,
          start: () => f.operation.start(),
          stop: () => f.operation.stop(),
          cancel: () => f.operation.cancel(),
        };
      },
      isSupported: () => true,
      notifyError: (message) => {
        f.errors.push(message);
      },
      notifyInfo: (message) => {
        notices.push(message);
      },
    },
  );
  const target = { kind: "conversation", id: "same" } as const;
  session.registerTargetHandlers(target, {
    appendTranscript: (text) => {
      f.transcripts.push(text);
    },
  });
  return { ...f, session, target, notices };
}

test("same-target session restart is not cleared by old start finally", async () => {
  const f = sessionFixture();
  const oldPermission = deferred<void>();
  const newPermission = deferred<void>();
  f.recorders.push({
    start: () => oldPermission.promise,
    stop: async () => accepted,
    cancel: async () => {},
  });
  f.recorders.push({
    start: () => newPermission.promise,
    stop: async () => accepted,
    cancel: async () => {},
  });
  const old = f.session.start(f.target);
  await f.session.cancel(f.target);
  const current = f.session.start(f.target);
  oldPermission.resolve();
  assert.equal(await old, false);
  assert.equal(f.session.pending, true);
  assert.equal(f.session.activeTarget, f.target);
  newPermission.resolve();
  assert.equal(await current, true);
  await f.session.cancel();
});

test("same-target session old stop cannot clear new target or deliver stale text", async () => {
  const f = sessionFixture();
  const response = deferred<string>();
  f.dependencies.transcribe = () => response.promise;
  await f.session.start(f.target);
  const old = f.session.stop(f.target);
  await tick();
  assert.equal(await f.session.stop(f.target), false);
  assert.equal(f.session.activeTarget, f.target);
  await f.session.cancel(f.target);
  await f.session.start(f.target);
  response.resolve("stale");
  assert.equal(await old, false);
  assert.equal(f.session.activeTarget, f.target);
  assert.equal(f.session.recording, true);
  assert.deepEqual(f.transcripts, []);
  await f.session.cancel();
});

for (const [reason, notice] of [
  ["no-activity", "No speech detected"],
  ["too-short", "Recording too short"],
] as const) {
  test(`session delivers informational notice for ${reason} and releases target`, async () => {
    const f = sessionFixture();
    f.recorders.push({
      start: async () => {},
      stop: async () => ({ status: "skipped", reason }),
      cancel: async () => {},
    });
    await f.session.start(f.target);
    assert.equal(await f.session.stop(f.target), false);
    assert.deepEqual(f.notices, [notice]);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.transcripts, []);
    assert.equal(f.session.activeTarget, undefined);
    await f.session.cancel();
  });
}

for (const outcome of ["accepted", "skipped", "failed"] as const) {
  test(`automatic stop releases session ownership after ${outcome}`, async () => {
    const f = sessionFixture(5);
    const settled = deferred<void>();
    const onSettled = f.callbacks.onSettled;
    f.callbacks.onSettled = () => {
      onSettled?.();
      settled.resolve();
    };
    if (outcome === "skipped") {
      f.recorders.push({
        start: async () => {},
        stop: async () => ({ status: "skipped", reason: "no-activity" }),
        cancel: async () => {},
      });
    } else if (outcome === "failed") {
      f.dependencies.isRetryable = () => false;
      f.dependencies.transcribe = async () => {
        throw new Error("upload failed");
      };
    }
    await f.session.start(f.target);
    await settled.promise;
    assert.equal(f.session.activeTarget, undefined);
    assert.equal(f.session.recording, false);
    assert.equal(f.session.pending, false);
    assert.deepEqual(f.transcripts, outcome === "accepted" ? ["hello"] : []);
    assert.deepEqual(
      f.notices,
      outcome === "skipped" ? ["No speech detected"] : [],
    );
    assert.deepEqual(f.errors, outcome === "failed" ? ["upload failed"] : []);
    await f.session.cancel();
  });
}

test("old automatic-stop completion cannot settle a same-target restart", async () => {
  const f = sessionFixture(5);
  const dispatched = deferred<void>();
  const response = deferred<string>();
  f.dependencies.transcribe = () => {
    dispatched.resolve();
    return response.promise;
  };
  await f.session.start(f.target);
  await dispatched.promise;
  await f.session.cancel(f.target);
  f.dependencies.maxDurationMs = 480_000;
  await f.session.start(f.target);
  response.resolve("stale auto-stop");
  await tick();
  assert.equal(f.session.activeTarget, f.target);
  assert.equal(f.session.recording, true);
  assert.deepEqual(f.transcripts, []);
  await f.session.cancel();
});
