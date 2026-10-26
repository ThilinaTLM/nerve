import assert from "node:assert/strict";
import test from "node:test";
import {
  fixture,
  definition,
  user,
} from "./agent-configuration-test-fixture.js";

void test("defaults capture retries a catalog change during asynchronous listing", async (t) => {
  const f = await fixture(t);
  await f.service.captureDefaults("p");
  const list = f.service.profiles.list.bind(f.service.profiles);
  let listed!: () => void;
  let resume!: () => void;
  const listedPromise = new Promise<void>((resolve) => {
    listed = resolve;
  });
  const resumePromise = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let first = true;
  f.service.profiles.list = async (...args) => {
    const snapshot = await list(...args);
    if (first) {
      first = false;
      listed();
      await resumePromise;
    }
    return snapshot;
  };
  const pending = f.service.captureDefaults("p");
  await listedPromise;
  await f.service.profiles.save(user, "coding", "missing", {
    ...definition,
    enabled: false,
  });
  resume();
  const captured = await pending;
  assert.equal(captured.isCurrent(), true);
  assert.equal(captured.options.subagentDefaults?.coding, false);
});
