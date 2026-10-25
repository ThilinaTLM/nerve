import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectAgentDefaultsResult } from "@nervekit/contracts/agent-configuration";
import { ProjectAgentDefaultsReadModel } from "./project-agent-defaults.js";

// Unavailable is a real server response too, and avoids irrelevant model fixtures.
const unavailable: ProjectAgentDefaultsResult = {
  status: "unavailable",
  diagnostics: [],
};

test("project defaults read model deduplicates loads and keeps projects isolated", async () => {
  const requests: string[] = [];
  const model = new ProjectAgentDefaultsReadModel(async (id) => {
    requests.push(id);
    return unavailable;
  });
  await Promise.all([model.load("a"), model.load("a"), model.load("b")]);
  assert.deepEqual(requests, ["a", "b"]);
  assert.equal(model.get("a"), unavailable);
  assert.equal(model.get("unknown"), undefined);
  await model.load("a");
  assert.equal(requests.length, 2);
  await model.refresh("b");
  assert.deepEqual(requests, ["a", "b", "b"]);
  await model.refresh();
  assert.deepEqual(requests, ["a", "b", "b", "a", "b"]);
});

test("refresh ignores older responses and failed loads can be retried", async () => {
  const requests: {
    resolve(value: ProjectAgentDefaultsResult): void;
    reject(error: Error): void;
  }[] = [];
  const model = new ProjectAgentDefaultsReadModel(
    () =>
      new Promise((resolve, reject) => {
        requests.push({ resolve, reject });
      }),
  );
  const first = model.load("a");
  const second = model.refresh("a");
  const latest = { ...unavailable };
  requests[1].resolve(latest);
  await second;
  requests[0].resolve(unavailable);
  await first;
  assert.equal(model.get("a"), latest);
  const failed = model.refresh("a");
  requests[2].reject(new Error("Disconnected"));
  await failed;
  assert.equal(model.get("a"), undefined);
  const retry = model.load("a");
  requests[3].resolve(unavailable);
  await retry;
  assert.equal(model.get("a"), unavailable);
});
