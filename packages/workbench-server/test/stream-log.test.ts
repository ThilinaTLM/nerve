import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  migrateLegacyEventLogs,
  StreamLog,
  StreamLogRegistry,
} from "../src/infrastructure/events/index.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nerve-stream-log-"));
}

const gitData = (reason: string) => ({ repo: ".", reason });

const contextData = (conversationId: string, tokens: number) => ({
  conversationId,
  contextUsage: { tokens, contextWindow: 10_000, percent: tokens / 100 },
});

const compactionStartedData = (conversationId: string) => ({
  conversationId,
  reason: "threshold" as const,
  startedAt: "2026-07-20T00:00:00.000Z",
  contextWindow: 10_000,
  contextTokens: 9_000,
  thresholdTokens: 8_500,
});

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("StreamLogRegistry", () => {
  it("assigns independent dense sequences and routes conversations", async () => {
    const home = await tempHome();
    const registry = new StreamLogRegistry(home);
    try {
      const workspace = await registry.publish(
        "git.repository.changed",
        gitData("one"),
      );
      const conversation = await registry.publish(
        "conversation.context.updated",
        {
          conversationId: "conv_one",
          contextUsage: { tokens: 1, contextWindow: 10, percent: 10 },
        },
      );
      assert.equal("seq" in workspace && workspace.seq, 1);
      assert.equal("seq" in conversation && conversation.seq, 1);
      assert.equal((await registry.bounds("workspace")).latestSeq, 1);
      assert.equal((await registry.bounds("conv/conv_one")).latestSeq, 1);
    } finally {
      await registry.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps context and compaction lifecycle events dense on the conversation stream", async () => {
    const home = await tempHome();
    const registry = new StreamLogRegistry(home);
    try {
      const context = await registry.publish("conversation.context.updated", {
        conversationId: "conv_compaction",
        contextUsage: { tokens: 29_500, contextWindow: 32_768, percent: 90 },
      });
      const started = await registry.publish(
        "conversation.compaction.started",
        {
          conversationId: "conv_compaction",
          reason: "threshold",
          startedAt: "2026-07-18T00:00:00.000Z",
          contextWindow: 32_768,
          contextTokens: 29_500,
          thresholdTokens: 29_491,
        },
      );
      const failed = await registry.publish("conversation.compaction.failed", {
        conversationId: "conv_compaction",
        reason: "threshold",
        failedAt: "2026-07-18T00:00:01.000Z",
        message: "fixture failure",
      });
      assert.deepEqual(
        [context, started, failed].map((event) => "seq" in event && event.seq),
        [1, 2, 3],
      );
      assert.deepEqual(
        (await registry.readStream("conv/conv_compaction", 1, 10)).events.map(
          (event) => event.type,
        ),
        [
          "conversation.context.updated",
          "conversation.compaction.started",
          "conversation.compaction.failed",
        ],
      );
    } finally {
      await registry.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("delays supersedable fsync and forces lifecycle fsync", async () => {
    const home = await tempHome();
    let fsyncs = 0;
    const flushes: Array<{
      stream: string;
      eventCount: number;
      succeeded: boolean;
    }> = [];
    const registry = new StreamLogRegistry(home, {
      flushDelayMs: 60_000,
      onFsync: () => (fsyncs += 1),
      onFlushCompleted: ({ stream, eventCount, succeeded }) =>
        flushes.push({ stream, eventCount, succeeded }),
    });
    try {
      await registry.hydrate();
      await registry.bounds("conv/conv_one");
      fsyncs = 0;
      await registry.publish("conversation.context.updated", {
        conversationId: "conv_one",
        contextUsage: { tokens: 1, contextWindow: 10, percent: 10 },
      });
      assert.equal(fsyncs, 0);
      await registry.flush();
      assert.equal(fsyncs, 1);

      fsyncs = 0;
      await registry.publish("git.repository.changed", gitData("lifecycle"));
      assert.equal(fsyncs, 1);
      assert.deepEqual(flushes, [
        { stream: "conv/conv_one", eventCount: 1, succeeded: true },
        { stream: "workspace", eventCount: 1, succeeded: true },
      ]);
    } finally {
      await registry.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not let a slow conversation stream block other streams", async () => {
    const home = await tempHome();
    const renameStarted = deferred();
    const releaseRename = deferred();
    let holdConversationRewrite = false;
    let heldConversationRewrite = false;
    const registry = new StreamLogRegistry(home, {
      retentionEvents: 1,
      renameDependencies: {
        rename: async (source, target) => {
          if (
            holdConversationRewrite &&
            !heldConversationRewrite &&
            target.endsWith("events.jsonl")
          ) {
            heldConversationRewrite = true;
            renameStarted.resolve();
            await releaseRename.promise;
          }
          await rename(source, target);
        },
      },
    });
    try {
      await registry.publish(
        "conversation.compaction.started",
        compactionStartedData("conv_slow_flush"),
      );
      holdConversationRewrite = true;
      const blocked = registry.publish("conversation.compaction.failed", {
        conversationId: "conv_slow_flush",
        reason: "threshold",
        failedAt: "2026-07-20T00:00:01.000Z",
        message: "fixture failure",
      });
      await renameStarted.promise;

      let sameStreamResolved = false;
      const sameStream = registry
        .publish(
          "conversation.compaction.started",
          compactionStartedData("conv_slow_flush"),
        )
        .then(() => {
          sameStreamResolved = true;
        });
      await registry.publish("git.repository.changed", gitData("parallel"));
      assert.equal(sameStreamResolved, false);

      releaseRename.resolve();
      await Promise.all([blocked, sameStream]);
      assert.equal(sameStreamResolved, true);
    } finally {
      releaseRename.resolve();
      await registry.shutdown().catch(() => undefined);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("applies retention only through each completed queued flush", async () => {
    const home = await tempHome();
    const renameStarted = deferred();
    const releaseRename = deferred();
    let holdConversationRewrite = false;
    let heldConversationRewrite = false;
    const registry = new StreamLogRegistry(home, {
      retentionEvents: 2,
      flushDelayMs: 0,
      renameDependencies: {
        rename: async (source, target) => {
          if (
            holdConversationRewrite &&
            !heldConversationRewrite &&
            target.endsWith("events.jsonl")
          ) {
            heldConversationRewrite = true;
            renameStarted.resolve();
            await releaseRename.promise;
          }
          await rename(source, target);
        },
      },
    });
    try {
      await registry.publish(
        "conversation.context.updated",
        contextData("conv_retention_queue", 100),
      );
      await registry.publish(
        "conversation.context.updated",
        contextData("conv_retention_queue", 200),
      );
      await registry.flush();
      holdConversationRewrite = true;
      await registry.publish(
        "conversation.context.updated",
        contextData("conv_retention_queue", 300),
      );
      await renameStarted.promise;
      await registry.publish(
        "conversation.context.updated",
        contextData("conv_retention_queue", 400),
      );

      releaseRename.resolve();
      await registry.shutdown();

      const replay = await registry.readStream(
        "conv/conv_retention_queue",
        1,
        10,
      );
      assert.deepEqual(
        replay.events.map((event) => event.seq),
        [3, 4],
      );
      const conversationDir = join(
        home,
        "conversations",
        "conv_retention_queue",
      );
      const persisted = (
        await readFile(join(conversationDir, "events.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { seq: number });
      assert.deepEqual(
        persisted.map((event) => event.seq),
        [3, 4],
      );
      assert.equal(
        (await readdir(conversationDir)).some((name) => name.endsWith(".tmp")),
        false,
      );
    } finally {
      releaseRename.resolve();
      await registry.shutdown().catch(() => undefined);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("writes metadata only when an empty rewrite needs a sequence floor", async () => {
    const home = await tempHome();
    const logPath = join(home, "events.jsonl");
    const metaPath = join(home, "events.meta.json");
    const log = await StreamLog.open({
      stream: "test",
      logPath,
      metaPath,
    });
    try {
      await log.append("evt_1", "test.event", { value: 1 }, false);
      assert.equal(
        await readdir(home).then((names) => names.includes("events.meta.json")),
        false,
      );
      await log.truncateBelow(2);
      assert.equal(JSON.parse(await readFile(metaPath, "utf8")).lastSeq, 1);
    } finally {
      await log.close();
    }

    const restored = await StreamLog.open({
      stream: "test",
      logPath,
      metaPath,
    });
    try {
      const next = await restored.append(
        "evt_2",
        "test.event",
        { value: 2 },
        false,
      );
      assert.equal(next.seq, 2);
    } finally {
      await restored.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("restores next sequence from the greater log tail when meta is stale", async () => {
    const home = await tempHome();
    const first = new StreamLogRegistry(home);
    await first.publish("git.repository.changed", gitData("one"));
    await first.shutdown();
    await writeFile(
      join(home, "logs", "workspace-events.meta.json"),
      '{"lastSeq":0}\n',
    );

    const restored = new StreamLogRegistry(home);
    try {
      await restored.hydrate();
      const event = await restored.publish(
        "git.repository.changed",
        gitData("two"),
      );
      assert.equal("seq" in event && event.seq, 2);
    } finally {
      await restored.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("truncates retention and exposes replay bounds", async () => {
    const home = await tempHome();
    const registry = new StreamLogRegistry(home, { retentionEvents: 2 });
    try {
      await registry.publish("git.repository.changed", gitData("one"));
      await registry.publish("git.repository.changed", gitData("two"));
      await registry.publish("git.repository.changed", gitData("three"));
      const read = await registry.readStream("workspace", 1, 10);
      assert.deepEqual(
        read.events.map((event) => event.seq),
        [2, 3],
      );
      assert.equal(read.earliestAvailableSeq, 2);
      assert.equal(read.latestSeq, 3);
    } finally {
      await registry.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("retries transient replacements and leaves no stream temp files", async () => {
    const home = await tempHome();
    let renameAttempts = 0;
    const registry = new StreamLogRegistry(home, {
      retentionEvents: 2,
      renameDependencies: {
        rename: async (source, target) => {
          renameAttempts += 1;
          if (renameAttempts <= 2) {
            throw Object.assign(new Error("temporarily locked"), {
              code: "EPERM",
            });
          }
          await rename(source, target);
        },
        delay: async () => undefined,
      },
    });
    try {
      await registry.publish("git.repository.changed", gitData("one"));
      await registry.publish("git.repository.changed", gitData("two"));
      await registry.publish("git.repository.changed", gitData("three"));
      assert.ok(renameAttempts > 2);
      assert.deepEqual(
        (await registry.readStream("workspace", 1, 10)).events.map(
          (event) => event.seq,
        ),
        [2, 3],
      );
      assert.equal(
        (await readdir(join(home, "logs"))).some((name) =>
          name.endsWith(".tmp"),
        ),
        false,
      );
    } finally {
      await registry.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("ignores a corrupted trailing JSONL line", async () => {
    const home = await tempHome();
    const first = new StreamLogRegistry(home);
    await first.publish("git.repository.changed", gitData("one"));
    await first.shutdown();
    await appendFile(
      join(home, "logs", "workspace-events.jsonl"),
      '{"partial":',
    );

    const restored = new StreamLogRegistry(home);
    try {
      await restored.hydrate();
      const event = await restored.publish(
        "git.repository.changed",
        gitData("two"),
      );
      assert.equal("seq" in event && event.seq, 2);
    } finally {
      await restored.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("deduplicates intent ids and sends ephemeral events only to notify", async () => {
    const home = await tempHome();
    const registry = new StreamLogRegistry(home);
    const notified: string[] = [];
    registry.subscribeNotify((event) => notified.push(event.id));
    try {
      const first = await registry.publishWithId(
        "evt_intent",
        "git.repository.changed",
        gitData("same"),
      );
      const duplicate = await registry.publishWithId(
        "evt_intent",
        "git.repository.changed",
        gitData("same"),
      );
      assert.equal(first, duplicate);
      const notify = await registry.publish("task.output", {
        taskId: "task_one",
        stream: "stdout",
        text: "hello",
      });
      assert.equal("seq" in notify, false);
      assert.deepEqual(notified, [notify.id]);
      assert.equal((await registry.bounds("workspace")).latestSeq, 1);
    } finally {
      await registry.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("event log migration", () => {
  it("archives sparse logs once and starts a dense epoch", async () => {
    const home = await tempHome();
    await writeFile(join(home, "placeholder"), "ok");
    const oldLog = join(home, "logs", "events.jsonl");
    await mkdir(join(home, "logs"), { recursive: true });
    await writeFile(oldLog, '{"seq":9}\n');
    const archive = await migrateLegacyEventLogs(home);
    assert.ok(archive);
    assert.equal(
      await readFile(join(archive as string, "logs", "events.jsonl"), "utf8"),
      '{"seq":9}\n',
    );
    assert.equal(await migrateLegacyEventLogs(home), undefined);
    await rm(home, { recursive: true, force: true });
  });
});
