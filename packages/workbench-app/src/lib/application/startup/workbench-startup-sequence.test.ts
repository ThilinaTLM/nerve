import assert from "node:assert/strict";
import test from "node:test";
import {
  runWorkbenchStartupSequence,
  type WorkbenchStartupPhase,
} from "./workbench-startup-sequence";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("starts critical dependencies together and blocks progressive activation", async () => {
  const settings = deferred<void>();
  const workspace = deferred<string | undefined>();
  const conversation = deferred<boolean>();
  const events: string[] = [];
  const current = true;
  const run = runWorkbenchStartupSequence({
    loadClientConfig: async () => "config",
    applyClientConfig: () => events.push("config"),
    loadCoreSettings: () => {
      events.push("settings:start");
      return settings.promise;
    },
    recoverWorkspace: () => {
      events.push("workspace:start");
      return workspace.promise;
    },
    restoreCriticalConversation: () => {
      events.push("conversation:start");
      return conversation.promise;
    },
    reconcileComposerSelection: () => {
      events.push("reconcile");
    },
    activateDeferredTab: () => {
      events.push("tab:activate");
    },
    startProgressiveWork: () => events.push("progressive:work"),
    transition: (phase) => {
      events.push(`phase:${phase}`);
      return current;
    },
    isCurrent: () => current,
  });

  await tick();
  assert.deepEqual(events.slice(0, 4), [
    "config",
    "phase:critical",
    "settings:start",
    "workspace:start",
  ]);
  workspace.resolve("conversation:1");
  await tick();
  assert.ok(events.includes("conversation:start"));
  conversation.resolve(true);
  await tick();
  assert.ok(!events.includes("phase:core-ready"));
  settings.resolve();
  await run;
  assert.ok(
    events.indexOf("phase:core-ready") < events.indexOf("phase:progressive"),
  );
  assert.ok(
    events.indexOf("phase:progressive") < events.indexOf("progressive:work"),
  );
});

test("keeps progressive work blocked while workspace recovery remains pending", async () => {
  const workspace = deferred<undefined>();
  const events: string[] = [];
  const run = runWorkbenchStartupSequence({
    loadClientConfig: async () => undefined,
    applyClientConfig: () => undefined,
    loadCoreSettings: async () => undefined,
    recoverWorkspace: () => workspace.promise,
    restoreCriticalConversation: async () => false,
    reconcileComposerSelection: () => undefined,
    activateDeferredTab: () => undefined,
    startProgressiveWork: () => events.push("progressive"),
    transition: () => true,
    isCurrent: () => true,
  });
  await tick();
  assert.deepEqual(events, []);
  workspace.resolve(undefined);
  await run;
  assert.deepEqual(events, ["progressive"]);
});

test("progressive feature failures do not reject core readiness", async () => {
  const result = await runWorkbenchStartupSequence({
    loadClientConfig: async () => undefined,
    applyClientConfig: () => undefined,
    loadCoreSettings: async () => undefined,
    recoverWorkspace: async () => undefined,
    restoreCriticalConversation: async () => false,
    reconcileComposerSelection: () => undefined,
    activateDeferredTab: () => {
      throw new Error("tab failed");
    },
    startProgressiveWork: () => {
      throw new Error("feature failed");
    },
    transition: () => true,
    isCurrent: () => true,
  });
  assert.equal(result.criticalBeforeProgressive, true);
});

test("critical failure suppresses progressive work", async () => {
  const events: string[] = [];
  await assert.rejects(
    runWorkbenchStartupSequence({
      loadClientConfig: async () => undefined,
      applyClientConfig: () => undefined,
      loadCoreSettings: async () => {
        throw new Error("models unavailable");
      },
      recoverWorkspace: async () => undefined,
      restoreCriticalConversation: async () => false,
      reconcileComposerSelection: () => undefined,
      activateDeferredTab: () => {
        events.push("tab");
      },
      startProgressiveWork: () => events.push("progressive"),
      transition: (phase) => {
        events.push(phase);
        return true;
      },
      isCurrent: () => true,
    }),
    /models unavailable/,
  );
  assert.ok(events.includes("failed"));
  assert.ok(!events.includes("progressive"));
});

test("stopping a generation invalidates late critical completions", async () => {
  const workspace = deferred<undefined>();
  const events: WorkbenchStartupPhase[] = [];
  let current = true;
  const run = runWorkbenchStartupSequence({
    loadClientConfig: async () => undefined,
    applyClientConfig: () => undefined,
    loadCoreSettings: async () => undefined,
    recoverWorkspace: () => workspace.promise,
    restoreCriticalConversation: async () => false,
    reconcileComposerSelection: () => undefined,
    activateDeferredTab: () => assert.fail("must not activate"),
    startProgressiveWork: () => assert.fail("must not start"),
    transition: (phase) => {
      events.push(phase);
      return current;
    },
    isCurrent: () => current,
  });
  await tick();
  current = false;
  workspace.resolve(undefined);
  await run;
  assert.deepEqual(events, ["critical"]);
});
