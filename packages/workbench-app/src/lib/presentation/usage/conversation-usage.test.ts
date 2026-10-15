import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationUsageMetrics,
  expectedCacheRate,
  isCacheRateCritical,
} from "./conversation-usage.js";

function metrics(responseCount: number, cachedPercent: number) {
  return conversationUsageMetrics({
    responseCount,
    input: 100 - cachedPercent,
    output: 0,
    cacheRead: cachedPercent,
    cacheWrite: 0,
    totalTokens: 100,
    cost: 0,
  });
}

void test("expected all-time cache rate rises with the response count", () => {
  assert.equal(expectedCacheRate(10), null);
  assert.equal(expectedCacheRate(11), 50);
  assert.equal(expectedCacheRate(21), 70);
  assert.equal(expectedCacheRate(31), 80);
  assert.equal(expectedCacheRate(51), 85);
  assert.equal(expectedCacheRate(500), 85);
});

void test("warns only once enough responses exist and below the tier", () => {
  assert.equal(isCacheRateCritical(metrics(10, 5)), false);
  assert.equal(isCacheRateCritical(metrics(11, 49)), true);
  assert.equal(isCacheRateCritical(metrics(11, 50)), false);
  assert.equal(isCacheRateCritical(metrics(25, 65)), true);
  assert.equal(isCacheRateCritical(metrics(60, 84)), true);
  assert.equal(isCacheRateCritical(metrics(60, 95)), false);
});
