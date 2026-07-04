import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LruCache } from "./lru-cache";

describe("LruCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.has("a"), true);
    assert.equal(cache.get("missing"), undefined);
    assert.equal(cache.size, 1);
  });

  it("evicts the least-recently-used entry past capacity", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    assert.equal(cache.has("a"), false);
    assert.equal(cache.get("b"), 2);
    assert.equal(cache.get("c"), 3);
    assert.equal(cache.size, 2);
  });

  it("promotes entries on get so they survive eviction", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    assert.equal(cache.get("a"), 1); // "a" now most-recently-used
    cache.set("c", 3); // evicts "b", not "a"
    assert.equal(cache.has("a"), true);
    assert.equal(cache.has("b"), false);
    assert.equal(cache.has("c"), true);
  });

  it("overwrites and promotes an existing key", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // overwrite + promote
    cache.set("c", 3); // evicts "b"
    assert.equal(cache.get("a"), 10);
    assert.equal(cache.has("b"), false);
    assert.equal(cache.has("c"), true);
    assert.equal(cache.size, 2);
  });

  it("supports delete and clear", () => {
    const cache = new LruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    assert.equal(cache.has("a"), false);
    assert.equal(cache.size, 1);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it("rejects a non-positive capacity", () => {
    assert.throws(() => new LruCache<string, number>(0));
  });
});
