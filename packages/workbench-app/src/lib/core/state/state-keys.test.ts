import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversationViewKey,
  fileViewKey,
  gitProjectStateKey,
  gitRepoStateKey,
  pendingConversationKey,
  prViewKey,
} from "$lib/core/state/state-keys";

const keyFns = [
  conversationViewKey,
  pendingConversationKey,
  fileViewKey,
  prViewKey,
  gitProjectStateKey,
  gitRepoStateKey,
];

const dangerousKeys = ["__proto__", "constructor", "prototype"];

describe("workbench state keys", () => {
  it("prefixes dynamic ids before they are used as object keys", () => {
    for (const keyFn of keyFns) {
      for (const rawKey of dangerousKeys) {
        const key = keyFn(rawKey);

        assert.notEqual(key, rawKey);
        assert.equal(key.includes(rawKey), true);
      }
    }
  });

  it("stores dangerous raw ids as safe own properties", () => {
    for (const keyFn of keyFns) {
      const store: Record<string, string> = {};
      for (const rawKey of dangerousKeys) {
        const key = keyFn(rawKey);
        store[key] = rawKey;

        assert.equal(Object.hasOwn(store, key), true);
        assert.equal(store[key], rawKey);
      }
      assert.equal(Object.getPrototypeOf(store), Object.prototype);
    }
  });
});
