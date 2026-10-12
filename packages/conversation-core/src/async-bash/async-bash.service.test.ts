import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openCoreStorage } from "../storage/core-storage.js";
import { AssetStore } from "../assets/asset-store.js";
import { AsyncBashService } from "./async-bash.service.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nerve-bash-pages-"));
  const storage = openCoreStorage(":memory:");
  const assets = new AssetStore(directory, storage);
  const now = "2026-10-10T00:00:00.000Z";
  storage.projects.insert({
    id: "proj_1",
    name: "Test",
    directory,
    createdAt: now,
    updatedAt: now,
  });
  storage.conversations.insert(
    {
      id: "conv_1",
      projectId: "proj_1",
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
      createdAt: now,
      updatedAt: now,
    },
    {
      conversationId: "conv_1",
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "baseline",
      mode: "coding",
      workingDirectory: directory,
    },
  );
  const bash = storage.asyncBash.insert({
    id: "bash_1",
    conversationId: "conv_1",
    toolCallId: "tool_1",
    command: "echo hi",
    workingDirectory: directory,
    processRef: null,
    status: "completed",
    exitCode: 0,
    startedAt: now,
    finishedAt: now,
  });
  // Historical reads must not need a live process or input service.
  const service = new AsyncBashService({
    storage,
    assets,
    emit: () => {},
    processes: {} as ConstructorParameters<
      typeof AsyncBashService
    >[0]["processes"],
    inputs: {} as ConstructorParameters<typeof AsyncBashService>[0]["inputs"],
  });
  return {
    storage,
    assets,
    service,
    bash,
    async output(name: string, content: string | Buffer) {
      return assets.write({
        conversationId: bash.conversationId,
        asyncBashId: bash.id,
        category: "bash_output",
        logicalPath: `conversations/conv_1/bash/bash_1/${name}.txt`,
        content,
      });
    },
    read: (
      page: {
        offsets?: { combined?: number; stdout?: number; stderr?: number };
        limit?: number;
      } = {},
    ) =>
      service.readLogPage({
        conversationId: "conv_1",
        bashId: "bash_1",
        ...page,
      }),
    async close() {
      storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

void test("completed history prefers combined output, tails and appends byte pages", async () => {
  const f = await fixture();
  try {
    const asset = await f.output("output", "0123456789");
    await f.output("stdout", "not combined");
    const tail = await f.read({ limit: 4 });
    assert.deepEqual(tail, {
      bash: f.bash,
      streams: [
        {
          stream: "combined",
          text: "6789",
          offset: 6,
          nextOffset: 10,
          totalBytes: 10,
        },
      ],
    });
    assert.equal(
      (await f.read({ offsets: { combined: 0 }, limit: 4 })).streams[0]!.text,
      "0123",
    );
    await appendFile(f.assets.path(asset.logicalPath), "abc");
    assert.deepEqual((await f.read({ offsets: { combined: 10 } })).streams[0], {
      stream: "combined",
      text: "abc",
      offset: 10,
      nextOffset: 13,
      totalBytes: 13,
    });
    assert.equal(
      (await f.read({ offsets: { combined: 999 } })).streams[0]!.nextOffset,
      13,
    );
    // Existing agent diagnostics remain a formatted string API.
    assert.equal(typeof (await f.service.logs("conv_1", "bash_1")), "string");
  } finally {
    await f.close();
  }
});

void test("log pages enforce ownership and the total byte budget", async () => {
  const f = await fixture();
  try {
    await f.output("stdout", "a".repeat(100000));
    await f.output("stderr", "b".repeat(100000));
    const page = await f.read();
    assert.deepEqual(
      page.streams.map((stream) => stream.stream),
      ["stdout", "stderr"],
    );
    assert.equal(
      page.streams.reduce((n, stream) => n + Buffer.byteLength(stream.text), 0),
      65536,
    );
    assert.equal(page.streams[0]!.totalBytes, 100000);
    for (const input of [
      { conversationId: "foreign", bashId: "bash_1" },
      { conversationId: "conv_1", bashId: "unknown" },
    ])
      await assert.rejects(
        f.service.readLogPage(input),
        /Async bash not found/,
      );
    for (const limit of [0, -1, 65537, 1.5])
      await assert.rejects(f.read({ limit }));
    await assert.rejects(f.read({ offsets: { stdout: -1 } }));
  } finally {
    await f.close();
  }
});

void test("UTF-8 pages skip partial starts and retain partial ends for the next append", async () => {
  const f = await fixture();
  try {
    const asset = await f.output("output", "a😀éZ");
    assert.deepEqual((await f.read({ limit: 5 })).streams[0], {
      stream: "combined",
      text: "éZ",
      offset: 5,
      nextOffset: 8,
      totalBytes: 8,
    });
    assert.equal(
      (await f.read({ offsets: { combined: 0 }, limit: 4 })).streams[0]!.text,
      "a",
    );
    assert.deepEqual(
      (await f.read({ offsets: { combined: 1 }, limit: 4 })).streams[0],
      {
        stream: "combined",
        text: "😀",
        offset: 1,
        nextOffset: 5,
        totalBytes: 8,
      },
    );
    const path = f.assets.path(asset.logicalPath);
    await writeFile(path, Buffer.from([0x61, 0xf0, 0x9f]));
    assert.equal(
      (await f.read({ offsets: { combined: 0 } })).streams[0]!.nextOffset,
      1,
    );
    await appendFile(path, Buffer.from([0x98, 0x80]));
    assert.equal(
      (await f.read({ offsets: { combined: 1 } })).streams[0]!.text,
      "😀",
    );
  } finally {
    await f.close();
  }
});

void test("missing outputs are empty and unsafe asset files never expose paths", async () => {
  const f = await fixture();
  try {
    assert.ok((await f.read()).streams.every((stream) => stream.text === ""));
    const asset = await f.output("output", "hello");
    const path = f.assets.path(asset.logicalPath);
    await rm(path);
    assert.deepEqual((await f.read()).streams, [
      { stream: "combined", text: "", offset: 0, nextOffset: 0, totalBytes: 0 },
    ]);
    await symlink("/etc/passwd", path);
    await assert.rejects(f.read(), { message: "Unable to read log asset" });
    assert.throws(
      () => f.assets.path("../outside/output.txt"),
      /Invalid managed asset path/,
    );
  } finally {
    await f.close();
  }
});
