import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GUIDE_COMPLETION_STORAGE_KEY,
  LEGACY_PRODUCT_TOUR_STORAGE_KEY,
  completeGuideVersion,
  readGuideCompletionVersions,
  writeGuideCompletionVersions,
} from "./completion.js";

type TestStorage = {
  values: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function memoryStorage(values: Record<string, string> = {}): TestStorage {
  return {
    values: { ...values },
    getItem(key) {
      return this.values[key] ?? null;
    },
    setItem(key, value) {
      this.values[key] = value;
    },
  };
}

describe("guide completion storage", () => {
  it("reads and writes validated per-guide versions", () => {
    const storage = memoryStorage();
    writeGuideCompletionVersions(
      { provider: 1, "web-search": 1, workbench: 2 },
      storage,
    );
    assert.deepEqual(readGuideCompletionVersions(storage), {
      provider: 1,
      "web-search": 1,
      workbench: 2,
    });
  });

  it("ignores unknown guides and invalid versions", () => {
    const storage = memoryStorage({
      [GUIDE_COMPLETION_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        guides: {
          provider: 1,
          unknown: 4,
          voice: -1,
          workbench: 1.5,
        },
      }),
    });
    assert.deepEqual(readGuideCompletionVersions(storage), { provider: 1 });
  });

  it("treats malformed or unsupported payloads as empty", () => {
    for (const value of ["not-json", "null", '{"schemaVersion":2}']) {
      assert.deepEqual(
        readGuideCompletionVersions(
          memoryStorage({ [GUIDE_COMPLETION_STORAGE_KEY]: value }),
        ),
        {},
      );
    }
  });

  it("migrates the legacy product-tour version when no catalog payload exists", () => {
    const storage = memoryStorage({
      [LEGACY_PRODUCT_TOUR_STORAGE_KEY]: "3",
    });
    assert.deepEqual(readGuideCompletionVersions(storage), { workbench: 3 });
  });

  it("advances a guide without mutating or downgrading versions", () => {
    const original = { provider: 2 } as const;
    assert.deepEqual(completeGuideVersion(original, "voice", 1), {
      provider: 2,
      voice: 1,
    });
    assert.equal(completeGuideVersion(original, "provider", 1), original);
  });

  it("tolerates unavailable client storage", () => {
    const storage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    assert.deepEqual(readGuideCompletionVersions(storage), {});
    assert.doesNotThrow(() =>
      writeGuideCompletionVersions({ provider: 1 }, storage),
    );
  });
});
