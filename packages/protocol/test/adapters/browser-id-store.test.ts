import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  protocolClientId,
  protocolInstanceId,
} from "../../src/adapters/browser-id-store.js";

const globals = globalThis as Record<string, unknown>;
const original = {
  localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
  sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
};

function install(name: "localStorage" | "sessionStorage", value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

afterEach(() => {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const descriptor = original[name];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globals[name];
  }
});

describe("browser id store", () => {
  it("persists a stable client id and reuses an existing one", () => {
    const storage = memoryStorage();
    install("localStorage", storage);
    const id = protocolClientId();
    assert.equal(protocolClientId(), id);
    assert.equal(storage.map.get("nerve.protocol.clientId"), id);
    storage.map.set("nerve.protocol.clientId", "cli_existing");
    assert.equal(protocolClientId(), "cli_existing");
  });

  it("generates a tab-prefixed instance id from session storage", () => {
    const storage = memoryStorage();
    install("sessionStorage", storage);
    const id = protocolInstanceId();
    assert.match(id, /^tab_/);
    assert.equal(protocolInstanceId(), id);
  });

  it("still returns an id when storage is missing", () => {
    delete globals.localStorage;
    delete globals.sessionStorage;
    assert.ok(protocolClientId());
    assert.match(protocolInstanceId(), /^tab_/);
  });

  it("still returns an id when the storage global itself throws on access", () => {
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(globalThis, name, {
        get: () => {
          throw new Error("denied");
        },
        configurable: true,
      });
    assert.ok(protocolClientId());
    assert.match(protocolInstanceId(), /^tab_/);
  });
});
