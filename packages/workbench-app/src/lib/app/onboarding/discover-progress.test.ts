import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISCOVER_SEEN_STORAGE_KEY,
  markEditorialSeen,
  readDiscoverSeenVersions,
  writeDiscoverSeenVersions,
} from "./discover-progress.js";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(DISCOVER_SEEN_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("Discover progress", () => {
  it("ignores absent, malformed, and unknown progress", () => {
    assert.deepEqual(readDiscoverSeenVersions(storage()), {});
    assert.deepEqual(readDiscoverSeenVersions(storage("not-json")), {});
    assert.deepEqual(
      readDiscoverSeenVersions(
        storage(
          JSON.stringify({
            schemaVersion: 1,
            seen: { unknown: 4, "discover-home": -1 },
          }),
        ),
      ),
      {},
    );
  });

  it("round trips validated editorial versions", () => {
    const target = storage();
    writeDiscoverSeenVersions(
      {
        "discover-home": 1,
        "workbench-tour": 1,
        "focused-model-list": 1,
        "tool-selection": 1,
      },
      target,
    );
    assert.deepEqual(readDiscoverSeenVersions(target), {
      "discover-home": 1,
      "workbench-tour": 1,
      "focused-model-list": 1,
      "tool-selection": 1,
    });
  });

  it("marks current versions seen and leaves newer versions unread", () => {
    const seen = markEditorialSeen({});
    assert.deepEqual(seen, {
      "discover-home": 1,
      "workbench-tour": 1,
      "focused-model-list": 1,
      "tool-selection": 1,
    });
    assert.equal((seen["discover-home"] ?? 0) < 2, true);
    assert.equal(markEditorialSeen(seen), seen);
  });
});
