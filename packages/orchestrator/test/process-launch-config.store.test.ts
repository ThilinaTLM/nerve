import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  processLaunchConfigSecretName,
  SecretProcessLaunchConfigStore,
} from "../src/domains/processes/process-launch-config.store.js";
import type { SecretProvider } from "../src/secrets.js";

class MemorySecretProvider implements SecretProvider {
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

describe("SecretProcessLaunchConfigStore", () => {
  it("writes and reads launch config", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretProcessLaunchConfigStore(secrets);

    await store.write("proc_test", {
      version: 1,
      env: { API_TOKEN: "secret", PORT: "4321" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });

    assert.deepEqual(await store.read("proc_test"), {
      version: 1,
      env: { API_TOKEN: "secret", PORT: "4321" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
  });

  it("removes launch config", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretProcessLaunchConfigStore(secrets);

    await store.write("proc_test", {
      version: 1,
      env: { PORT: "4321" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
    await store.remove("proc_test");

    assert.equal(await store.read("proc_test"), undefined);
  });

  it("throws clearly for invalid stored JSON", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretProcessLaunchConfigStore(secrets);
    await secrets.set(processLaunchConfigSecretName("proc_test"), "{");

    await assert.rejects(
      () => store.read("proc_test"),
      /Invalid persisted launch config for process proc_test/,
    );
  });

  it("throws clearly for invalid stored schema", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretProcessLaunchConfigStore(secrets);
    await secrets.set(
      processLaunchConfigSecretName("proc_test"),
      JSON.stringify({ version: 2, env: { PORT: "4321" } }),
    );

    await assert.rejects(
      () => store.read("proc_test"),
      /Invalid persisted launch config for process proc_test/,
    );
  });
});
