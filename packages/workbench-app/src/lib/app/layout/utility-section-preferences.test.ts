import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUtilitySectionPreferences,
  utilitySectionStorageKey,
} from "./utility-section-preferences.svelte";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("utility section preferences", () => {
  it("defaults every missing section to expanded and persists changes", () => {
    const storage = new MemoryStorage();
    const preferences = createUtilitySectionPreferences(storage);

    assert.equal(preferences.isOpen("git.repository"), true);
    assert.equal(preferences.isOpen("tasks.finished"), true);

    preferences.setOpen("git.repository", false);
    assert.equal(preferences.isOpen("git.repository"), false);
    assert.deepEqual(
      JSON.parse(storage.getItem(utilitySectionStorageKey) ?? ""),
      {
        "git.repository": false,
      },
    );
  });

  it("restores only boolean entries and safely ignores malformed storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      utilitySectionStorageKey,
      JSON.stringify({
        "context.active": false,
        "context.agents": "closed",
        "notes.note-1": true,
      }),
    );
    const preferences = createUtilitySectionPreferences(storage);

    assert.equal(preferences.isOpen("context.active"), false);
    assert.equal(preferences.isOpen("context.agents"), true);
    assert.equal(preferences.isOpen("notes.note-1"), true);
    assert.equal(preferences.isOpen("notes.note-2"), true);

    storage.setItem(utilitySectionStorageKey, "not-json");
    const fallback = createUtilitySectionPreferences(storage);
    assert.equal(fallback.isOpen("context.active"), true);
  });

  it("keeps dynamic note preferences independent", () => {
    const preferences = createUtilitySectionPreferences(new MemoryStorage());

    preferences.setOpen("notes.first", false);
    assert.equal(preferences.isOpen("notes.first"), false);
    assert.equal(preferences.isOpen("notes.second"), true);
  });
});
