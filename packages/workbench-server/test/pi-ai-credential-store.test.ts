import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PiAiCredentialStore } from "../src/domains/auth/pi-ai-credential-store.js";
import type { SecretProvider } from "../src/infrastructure/secrets/index.js";

class MemorySecrets implements SecretProvider {
  readonly values = new Map<string, string>();

  async get(name: string): Promise<string | undefined> {
    return this.values.get(name);
  }

  async set(name: string, value: string): Promise<void> {
    this.values.set(name, value);
  }

  async delete(name: string): Promise<void> {
    this.values.delete(name);
  }

  async list(): Promise<string[]> {
    return [...this.values.keys()].sort();
  }
}

describe("PiAiCredentialStore", () => {
  it("keeps API-key and OAuth credentials mutually exclusive", async () => {
    const store = new PiAiCredentialStore(new MemorySecrets());
    await store.modify("anthropic", async () => ({
      type: "api_key",
      key: "api-key",
    }));
    await store.modify("anthropic", async () => ({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: Date.now() + 60_000,
    }));

    assert.equal((await store.read("anthropic"))?.type, "oauth");
    assert.deepEqual(await store.list(), [
      { providerId: "anthropic", type: "oauth" },
    ]);
  });

  it("serializes concurrent refresh modifications", async () => {
    const store = new PiAiCredentialStore(new MemorySecrets());
    await store.modify("xai", async () => ({
      type: "oauth",
      access: "old",
      refresh: "refresh",
      expires: 0,
    }));
    let refreshes = 0;
    const refresh = () =>
      store.modify("xai", async (current) => {
        if (current?.type !== "oauth" || current.expires > Date.now())
          return undefined;
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ...current, access: "new", expires: Date.now() + 60_000 };
      });

    await Promise.all([refresh(), refresh()]);

    assert.equal(refreshes, 1);
    const credential = await store.read("xai");
    assert.equal(credential?.type === "oauth" && credential.access, "new");
  });
});
