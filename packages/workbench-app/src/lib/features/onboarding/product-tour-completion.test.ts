import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRODUCT_TOUR_COMPLETION_STORAGE_KEY,
  readProductTourCompletionVersion,
  writeProductTourCompletionVersion,
} from "./product-tour-completion.js";

type TestStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function memoryStorage(initial?: string): TestStorage & { value?: string } {
  const storage: TestStorage & { value?: string } = {
    value: initial,
    getItem(key) {
      assert.equal(key, PRODUCT_TOUR_COMPLETION_STORAGE_KEY);
      return this.value ?? null;
    },
    setItem(key, value) {
      assert.equal(key, PRODUCT_TOUR_COMPLETION_STORAGE_KEY);
      this.value = value;
    },
  };
  return storage;
}

describe("product tour completion storage", () => {
  it("reads a persisted nonnegative integer version", () => {
    assert.equal(readProductTourCompletionVersion(memoryStorage("2")), 2);
  });

  it("treats absent and malformed versions as incomplete", () => {
    for (const value of [undefined, "", "-1", "1.5", "01", "complete"]) {
      assert.equal(readProductTourCompletionVersion(memoryStorage(value)), 0);
    }
  });

  it("persists valid versions and ignores invalid writes", () => {
    const storage = memoryStorage();
    writeProductTourCompletionVersion(3, storage);
    assert.equal(storage.value, "3");
    writeProductTourCompletionVersion(-1, storage);
    writeProductTourCompletionVersion(1.5, storage);
    assert.equal(storage.value, "3");
  });

  it("tolerates unavailable client storage", () => {
    const storage: TestStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    assert.equal(readProductTourCompletionVersion(storage), 0);
    assert.doesNotThrow(() => writeProductTourCompletionVersion(1, storage));
  });
});
