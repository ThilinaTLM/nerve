import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSandboxUtilitySectionPreferences,
  sandboxUtilitySectionStorageKey,
} from "./sandbox-utility-section-preferences.svelte";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("sandbox utility section preferences", () => {
  it("defaults missing sections to expanded and persists independent values", () => {
    const storage = new MemoryStorage();
    const preferences = createSandboxUtilitySectionPreferences(storage);

    assert.equal(preferences.isOpen("git.setup"), true);
    assert.equal(preferences.isOpen("context.config"), true);

    preferences.setOpen("git.setup", false);
    preferences.setOpen("tasks.finished", false);

    assert.equal(preferences.isOpen("git.setup"), false);
    assert.equal(preferences.isOpen("tasks.finished"), false);
    assert.equal(preferences.isOpen("tasks.running"), true);
    assert.deepEqual(
      JSON.parse(storage.getItem(sandboxUtilitySectionStorageKey) ?? ""),
      { "git.setup": false, "tasks.finished": false },
    );
  });

  it("restores booleans and ignores invalid or malformed entries", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      sandboxUtilitySectionStorageKey,
      JSON.stringify({
        "context.runtime": false,
        "context.details": null,
        "context.config": "false",
      }),
    );
    const preferences = createSandboxUtilitySectionPreferences(storage);

    assert.equal(preferences.isOpen("context.runtime"), false);
    assert.equal(preferences.isOpen("context.details"), true);
    assert.equal(preferences.isOpen("context.config"), true);

    storage.setItem(sandboxUtilitySectionStorageKey, "[");
    const fallback = createSandboxUtilitySectionPreferences(storage);
    assert.equal(fallback.isOpen("context.runtime"), true);
  });
});
