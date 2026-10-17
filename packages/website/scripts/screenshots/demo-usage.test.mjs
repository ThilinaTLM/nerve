import assert from "node:assert/strict";
import { test } from "node:test";
import { demoUsageResponse } from "./demo-usage.mjs";

const request = {
  protocol: "nerve",
  version: 1,
  id: "demo-request",
  kind: "request",
  ts: "2026-10-17T12:00:00.000Z",
  source: { role: "ui" },
  target: { role: "workbench_server" },
  data: { method: "usage.subscription.get", params: {} },
};

test("supplies synthetic quotas correlated to the usage request", () => {
  const response = demoUsageResponse(request);
  assert.equal(response.replyTo, request.id);
  assert.equal(response.kind, "response");
  assert.deepEqual(response.source, request.target);
  assert.deepEqual(response.target, request.source);
  assert.equal(response.data.ok, true);
  assert.equal(response.data.method, request.data.method);
  const [usage] = response.data.result.usage;
  assert.equal(usage.provider, "anthropic");
  assert.equal(usage.session.usedPercent, 32);
  assert.equal(usage.weekly.usedPercent, 46);
  assert.equal(usage.session.windowMinutes, 300);
  assert.equal(usage.weekly.windowMinutes, 10080);
  assert.equal(usage.updatedAt, request.ts);
});

test("leaves unrelated requests and non-request frames untouched", () => {
  for (const message of [
    null,
    {},
    { ...request, protocol: "other" },
    { ...request, version: 2 },
    { ...request, kind: "event" },
    { ...request, data: { method: "conversations.list" } },
  ]) {
    assert.equal(demoUsageResponse(message), undefined);
  }
});
