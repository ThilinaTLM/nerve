import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  loadProjectGroupCollapseState,
  projectGroupCollapseStorageKey,
  sanitizeProjectGroupCollapseState,
  saveProjectGroupCollapseState,
} from "./project-group-collapse";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function setLocalStorage(storage: Storage | undefined): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("project group collapse state", () => {
  it("keeps only non-empty string keys with true values", () => {
    assert.deepEqual(
      sanitizeProjectGroupCollapseState({
        "": true,
        "   ": true,
        "/tmp/collapsed": true,
        "/tmp/expanded": false,
        "/tmp/null": null,
        "/tmp/one": 1,
      }),
      { "/tmp/collapsed": true },
    );
  });

  it("loads an empty state when storage is unavailable", () => {
    setLocalStorage(undefined);

    assert.deepEqual(loadProjectGroupCollapseState(), {});
  });

  it("loads an empty state when stored JSON is malformed", () => {
    const storage = new MemoryStorage();
    storage.setItem(projectGroupCollapseStorageKey, "not json");
    setLocalStorage(storage);

    assert.deepEqual(loadProjectGroupCollapseState(), {});
  });

  it("loads sanitized stored state", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      projectGroupCollapseStorageKey,
      JSON.stringify({ "/tmp/collapsed": true, "/tmp/expanded": false }),
    );
    setLocalStorage(storage);

    assert.deepEqual(loadProjectGroupCollapseState(), {
      "/tmp/collapsed": true,
    });
  });

  it("removes the storage item when saving an empty state", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      projectGroupCollapseStorageKey,
      JSON.stringify({ old: true }),
    );
    setLocalStorage(storage);

    saveProjectGroupCollapseState({});

    assert.equal(storage.getItem(projectGroupCollapseStorageKey), null);
  });

  it("writes sanitized JSON when saving a non-empty state", () => {
    const storage = new MemoryStorage();
    setLocalStorage(storage);

    saveProjectGroupCollapseState({
      "/tmp/collapsed": true,
      "/tmp/expanded": false as unknown as true,
    });

    assert.deepEqual(
      JSON.parse(storage.getItem(projectGroupCollapseStorageKey) ?? "{}"),
      { "/tmp/collapsed": true },
    );
  });
});
