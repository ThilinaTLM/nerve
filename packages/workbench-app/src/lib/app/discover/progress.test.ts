import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverNewsCatalog } from "./content/news.js";
import {
  DISCOVER_STORAGE_KEY,
  markAllSeen,
  readDiscoverProgress,
  writeDiscoverProgress,
} from "./progress.js";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(DISCOVER_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const newsId = discoverNewsCatalog[0]!.id;

describe("Discover progress", () => {
  it("reports absent, malformed, and foreign-schema storage as a first run", () => {
    assert.equal(readDiscoverProgress(storage()), undefined);
    assert.equal(readDiscoverProgress(storage("not-json")), undefined);
    assert.equal(
      readDiscoverProgress(storage(JSON.stringify({ schemaVersion: 2 }))),
      undefined,
    );
    assert.equal(readDiscoverProgress(undefined), undefined);
  });

  it("drops unknown entries and invalid versions while keeping the record", () => {
    const progress = readDiscoverProgress(
      storage(
        JSON.stringify({
          schemaVersion: 1,
          seen: { unknown: 4, [newsId]: -1 },
          autoOpen: { enabled: "yes", version: 3, count: 1.5 },
        }),
      ),
    );
    assert.deepEqual(progress, {
      seen: {},
      autoOpen: { enabled: true, version: undefined, count: 0 },
    });
  });

  it("round trips seen versions and the auto-open budget", () => {
    const target = storage();
    writeDiscoverProgress(
      {
        seen: { [newsId]: 1 },
        autoOpen: { enabled: false, version: "0.29.0", count: 2 },
      },
      target,
    );
    assert.deepEqual(readDiscoverProgress(target), {
      seen: { [newsId]: 1 },
      autoOpen: { enabled: false, version: "0.29.0", count: 2 },
    });
  });

  it("marks every news entry read at its catalog version", () => {
    const seen = markAllSeen({});
    for (const entry of discoverNewsCatalog) {
      assert.equal(seen[entry.id], entry.version);
    }
    assert.equal(markAllSeen(seen), seen);
  });
});
