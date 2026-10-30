import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openCoreStorage } from "../storage/core-storage.js";
import { AssetStore } from "../assets/asset-store.js";
import { AsyncBashService } from "./async-bash.service.js";
import { InputQueueService } from "../inputs/input-queue.service.js";
import type { BackgroundProcess, ProcessPort } from "../ports.js";

async function fixture(processes: ProcessPort = {} as ProcessPort) {
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
      agentProfile: "coding",
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
    processes,
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
    assert.match(
      await f.service.logs("conv_1", "bash_1"),
      /\(completed; exit code: 0\)/,
    );
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

void test("agent log headers distinguish actual, unknown and running exit codes", async () => {
  const f = await fixture();
  try {
    await f.output("output", "hello");
    for (const [status, exitCode] of [
      ["completed", 0],
      ["failed", 7],
      ["lost", null],
      ["running", null],
    ] as const) {
      f.storage.asyncBash.update(f.bash.id, { status, exitCode });
      const logs = await f.service.logs("conv_1", f.bash.id);
      const expected =
        status === "running"
          ? "(running)"
          : `(${status}; exit code: ${exitCode ?? "unknown"})`;
      assert.ok(logs.includes(expected), logs);
      if (status === "running") assert.doesNotMatch(logs, /exit code:/);
    }
  } finally {
    await f.close();
  }
});

for (const exitCode of [0, 7, null]) {
  void test(`process completion automatically queues one explicit exit-code notice (${exitCode ?? "unknown"})`, async () => {
    const f = await fixture();
    try {
      const stdout = await f.output("stdout", "hello");
      const stderr = await f.output("stderr", "");
      const status =
        exitCode === null
          ? "cancelled"
          : exitCode === 0
            ? "completed"
            : "failed";
      const process: BackgroundProcess = {
        ref: "process",
        outputFiles: {
          stdout: f.assets.path(stdout.logicalPath),
          stderr: f.assets.path(stderr.logicalPath),
        },
        wait: async () => ({ status, exitCode }),
        cancel: async () => {},
      };
      const processes = {} as ProcessPort;
      const pendingSnapshots: boolean[] = [];
      const observe = () =>
        pendingSnapshots.push(
          f.storage.conversations.getSummary("conv_1")!.pendingWork,
        );
      const inputs = new InputQueueService({
        storage: f.storage,
        processes,
        emit: observe,
        requestWake: () => {},
      });
      let finished!: () => void;
      const completion = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const service = new AsyncBashService({
        storage: f.storage,
        assets: f.assets,
        processes,
        inputs,
        emit: (change) => {
          observe();
          if (
            change.kind === "async_bash_changed" &&
            change.asyncBash.some(
              (row) => row.toolCallId === "tool_2" && row.status !== "running",
            )
          )
            finished();
        },
      });
      const bash = await service.adopt({
        conversationId: "conv_1",
        toolCallId: "tool_2",
        command: "echo hello",
        cwd: f.bash.workingDirectory,
        process,
      });
      await completion;
      const queued = f.storage.inputs.list("conv_1");
      assert.equal(queued.length, 1);
      const notice = queued[0]!.content;
      assert.notEqual(typeof notice, "string");
      if (typeof notice === "string") throw new Error("Expected system notice");
      assert.equal(notice.subtype, "async_bash_event");
      if (notice.subtype !== "async_bash_event")
        throw new Error("Expected bash notice");
      assert.equal(
        notice.text,
        `echo hello\nStatus: ${status}; exit code: ${exitCode ?? "unknown"}\nhello`,
      );
      assert.equal(notice.exitCode, exitCode);
      assert.equal(notice.status, status);
      assert.equal(notice.producer, bash.id);
      assert.equal(f.storage.asyncBash.get(bash.id)?.exitCode, exitCode);
      assert.ok(pendingSnapshots.length > 0);
      assert.ok(
        pendingSnapshots.every(Boolean),
        "no quiet summary between process completion and wake delivery",
      );
      assert.equal(
        f.storage.conversations.getSummary("conv_1")!.pendingWork,
        true,
      );
      inputs.deliver("conv_1", { kind: "turn" });
      assert.equal(
        f.storage.conversations.getSummary("conv_1")!.pendingWork,
        false,
      );
    } finally {
      await f.close();
    }
  });
}

void test("async bash start supplies conversation identity for effective shell resolution", async () => {
  const starts: Parameters<ProcessPort["start"]>[0][] = [];
  const f = await fixture({
    async start(input) {
      starts.push(input);
      throw new Error("Host refused process");
    },
    async run() {
      throw new Error("No run expected");
    },
    async reattach() {
      return null;
    },
  });
  try {
    await assert.rejects(
      f.service.start({
        conversationId: "conv_1",
        toolCallId: "tool_start",
        command: "echo hello",
        cwd: f.bash.workingDirectory,
        signal: new AbortController().signal,
      }),
      /Host refused process/,
    );
    assert.equal(starts.length, 1);
    assert.equal(starts[0]!.conversationId, "conv_1");
    assert.equal(starts[0]!.cwd, f.bash.workingDirectory);
  } finally {
    await f.close();
  }
});

void test("deletion ignores completed process refs and never cancels an unverifiable process", async () => {
  let reattachments = 0;
  const unexpected = async (): Promise<never> => {
    throw new Error("No process should start");
  };
  const f = await fixture({
    start: unexpected,
    run: unexpected,
    reattach: async () => {
      reattachments++;
      throw new Error("Unverifiable process");
    },
  });
  try {
    f.storage.asyncBash.update(f.bash.id, { processRef: "old-ref" });
    await f.service.discard([f.bash.id]);
    assert.equal(reattachments, 0);
    f.storage.asyncBash.update(f.bash.id, {
      status: "running",
      exitCode: null,
      finishedAt: null,
    });
    await f.service.discard([f.bash.id]);
    assert.equal(reattachments, 1);
    assert.equal(
      f.storage.asyncBash.get(f.bash.id)?.status,
      "running",
      "raw deletion, not a fake completion, owns removal",
    );
  } finally {
    await f.close();
  }
});
