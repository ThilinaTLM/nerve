import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SecretTaskLaunchConfigStore,
  taskLaunchConfigSecretName,
} from "../src/domains/tasks/task-launch-config.store.js";
import type { SecretProvider } from "../src/infrastructure/secrets/index.js";

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

describe("SecretTaskLaunchConfigStore", () => {
  it("writes and reads launch config", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretTaskLaunchConfigStore(secrets);

    await store.write("task_test", {
      version: 1,
      env: { API_TOKEN: "secret", PORT: "4321" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });

    assert.deepEqual(await store.read("task_test"), {
      version: 1,
      env: { API_TOKEN: "secret", PORT: "4321" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
  });

  it("removes launch config", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretTaskLaunchConfigStore(secrets);

    await store.write("task_test", {
      version: 1,
      env: { PORT: "4321" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
    await store.remove("task_test");

    assert.equal(await store.read("task_test"), undefined);
  });

  it("throws clearly for invalid stored JSON", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretTaskLaunchConfigStore(secrets);
    await secrets.set(taskLaunchConfigSecretName("task_test"), "{");

    await assert.rejects(
      () => store.read("task_test"),
      /Invalid persisted launch config for task task_test/,
    );
  });

  it("throws clearly for invalid stored schema", async () => {
    const secrets = new MemorySecretProvider();
    const store = new SecretTaskLaunchConfigStore(secrets);
    await secrets.set(
      taskLaunchConfigSecretName("task_test"),
      JSON.stringify({ version: 2, env: { PORT: "4321" } }),
    );

    await assert.rejects(
      () => store.read("task_test"),
      /Invalid persisted launch config for task task_test/,
    );
  });
});
