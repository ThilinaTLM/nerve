import assert from "node:assert/strict";
import test from "node:test";
import { openCoreStorage, type CoreStorage } from "../storage/core-storage.js";
import { ProjectService } from "./project.service.js";

const now = () => "2026-10-18T00:00:00.000Z";

function seedConversation(storage: CoreStorage) {
  storage.conversations.insert(
    {
      id: "conversation",
      projectId: "project",
      parentConversationId: null,
      parentToolCallId: null,
      headEventId: null,
      title: "Test",
      status: "idle",
      statusEventSequence: 0,
      statusClearedAt: null,
      paused: false,
      nextInputSequence: 1,
      pinnedAt: null,
      completedAt: null,
      lastUserMessageAt: null,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      conversationId: "conversation",
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "baseline",
      agentProfile: "coding",
      workingDirectory: "/tmp",
    },
  );
}

test("project deletion invokes and awaits its callback once after removal", async () => {
  const storage = openCoreStorage(":memory:");
  try {
    const calls: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ProjectService(
      storage,
      async (id) => {
        calls.push(`conversation:${id}`);
        storage.conversations.delete(id);
      },
      now,
      async (id) => {
        assert.equal(storage.projects.get(id), null);
        calls.push(`project:${id}`);
        await pending;
      },
    );
    service.create({ id: "project", name: "Test", directory: "/tmp" });
    seedConversation(storage);
    let completed = false;
    const deletion = service.delete("project").then(() => {
      completed = true;
    });
    // Reach the callback without releasing its asynchronous cleanup.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["conversation:conversation", "project:project"]);
    assert.equal(completed, false);
    release();
    await deletion;
    assert.equal(completed, true);
  } finally {
    storage.close();
  }
});

test("failed conversation deletion does not invoke the project callback", async () => {
  const storage = openCoreStorage(":memory:");
  try {
    let callbacks = 0;
    const failure = new Error("conversation deletion failed");
    const service = new ProjectService(
      storage,
      async () => {
        throw failure;
      },
      now,
      () => {
        callbacks++;
      },
    );
    service.create({ id: "project", name: "Test", directory: "/tmp" });
    seedConversation(storage);
    await assert.rejects(service.delete("project"), failure);
    assert.ok(service.get("project"));
    assert.equal(callbacks, 0);
  } finally {
    storage.close();
  }
});

test("failed project removal does not invoke the project callback", async (t) => {
  const storage = openCoreStorage(":memory:");
  try {
    let callbacks = 0;
    const service = new ProjectService(
      storage,
      async () => {},
      now,
      () => {
        callbacks++;
      },
    );
    service.create({ id: "project", name: "Test", directory: "/tmp" });
    const failure = new Error("project removal failed");
    t.mock.method(storage.projects, "delete", () => {
      throw failure;
    });
    await assert.rejects(service.delete("project"), failure);
    assert.ok(service.get("project"));
    assert.equal(callbacks, 0);
  } finally {
    storage.close();
  }
});
