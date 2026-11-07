import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationEvent } from "@nervekit/contracts/core";
import { buildModelMessages } from "../context/context-projection.js";
import { ConversationCore } from "../core.js";
import {
  createConversation,
  options,
  type TestOptions,
} from "../runtime/lifecycle-test-helpers.js";
import { forkTitle } from "./conversation-fork.js";

const at = "2026-10-10T00:00:00.000Z";
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface Fixture {
  directory: string;
  opts: TestOptions;
  core: ConversationCore;
  /** Last event of the path to fork; a side branch hangs off `branchFrom`. */
  forkPoint: string;
  sideBranch: string;
  resultAssetId: string;
}

function message(
  id: string,
  type: "user_message",
  text: string,
  previousEventId: string | null,
) {
  return {
    id,
    conversationId: "src",
    previousEventId,
    type,
    llmRepresentation: "user" as const,
    turnId: null,
    inputId: null,
    createdAt: at,
    payload: {
      text,
      originalText: text,
      source: "user" as const,
      senderConversationId: null,
    },
  };
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "conv-fork-"));
  const unexpected = async (): Promise<never> => {
    throw new Error("No execution expected");
  };
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    { resolve: unexpected },
    { execute: unexpected, isReplaySafe: () => false },
  );
  const core = new ConversationCore(opts);
  await core.start();
  await createConversation(core, "src");
  opts.storage.conversations.update("src", { title: "Plan" });
  const { events } = opts.storage;
  const reportPath = join(directory, "conversations/kid/reports/exec1.md");
  await mkdir(join(directory, "conversations/kid/reports"), {
    recursive: true,
  });
  await writeFile(reportPath, "full report");
  events.append(message("evt_user", "user_message", "hello", null));
  events.append({
    id: "evt_assistant",
    conversationId: "src",
    type: "assistant_message",
    llmRepresentation: "assistant",
    turnId: "turn1",
    inputId: null,
    createdAt: at,
    payload: {
      content: [
        {
          type: "toolCall",
          id: "provider1",
          name: "read",
          arguments: {},
        },
        {
          type: "toolCall",
          id: "provider2",
          name: "subagent_prompt",
          arguments: {},
        },
      ],
      usage,
      stopReason: "toolUse",
      api: "test",
      provider: "test",
      model: "test",
    },
  });
  const result = await core.assets.write({
    conversationId: "src",
    toolCallId: "tool1",
    category: "payload",
    logicalPath: "conversations/src/tool-calls/tool1/result.json",
    content: '{"ok":true}',
  });
  await mkdir(join(directory, "conversations/src/tool-calls/tool1/files"), {
    recursive: true,
  });
  await writeFile(
    join(directory, "conversations/src/tool-calls/tool1/files/out.txt"),
    "artifact",
  );
  const response = (
    id: string,
    toolCallId: string,
    toolName: string,
    index: number,
    assetIds: string[],
    text: string,
  ) =>
    events.append({
      id,
      conversationId: "src",
      type: "tool_call_response",
      llmRepresentation: "tool_result",
      turnId: "turn1",
      inputId: null,
      createdAt: at,
      payload: {
        toolCallId,
        providerCallId: `provider${index + 1}`,
        toolName,
        arguments: {},
        origin: "model",
        assistantEventId: "evt_assistant",
        contentIndex: index,
        outcome: "completed",
        agentProjection: [{ type: "text", text }],
        userProjection: { argsPreview: {}, resultPreview: {} },
        supervision: null,
        interactionResolution: null,
        resolutionRequestId: null,
        assetIds,
      },
    });
  response(
    "evt_read",
    "tool1",
    "read",
    0,
    [result.id],
    `see ${directory}/conversations/src/tool-calls/tool1/files/out.txt`,
  );
  core.assets.linkToEvent([result.id], "evt_read");
  response(
    "evt_sub",
    "sub1",
    "subagent_prompt",
    1,
    [],
    `Full response: ${reportPath}`,
  );
  const forkPoint = events.append({
    id: "evt_end",
    conversationId: "src",
    type: "assistant_message",
    llmRepresentation: "assistant",
    turnId: "turn2",
    inputId: null,
    createdAt: at,
    payload: {
      content: [{ type: "text", text: "done" }],
      usage,
      stopReason: "stop",
      api: "test",
      provider: "test",
      model: "test",
    },
  }).id;
  // The side branch is the source's current head.
  const sideBranch = events.append({
    ...message("evt_side", "user_message", "another idea", "evt_read"),
  }).id;
  opts.storage.conversations.insert(
    {
      ...opts.storage.conversations.get("src")!,
      id: "kid",
      parentConversationId: "src",
      parentToolCallId: "sub1",
      headEventId: null,
      title: "explore-auth",
    },
    { conversationId: "kid", workingDirectory: directory },
  );
  return {
    directory,
    opts,
    core,
    forkPoint,
    sideBranch,
    resultAssetId: result.id,
  };
}

const pathOf = (opts: TestOptions, id: string): ConversationEvent[] =>
  opts.storage.events
    .pathFromHead(id, { limit: Number.MAX_SAFE_INTEGER })
    .reverse();

void test("fork copies only the path, remaps identities and files, and leaves the source untouched", async () => {
  const f = await fixture();
  try {
    const sourceEvents = f.opts.storage.events.since("src", 0);
    const sourceAssets = f.opts.storage.assets.list("src");
    const snapshot = await f.core.fork("src", f.forkPoint);
    const id = snapshot.conversation.id;
    assert.equal(snapshot.conversation.title, "F1: Plan");
    assert.equal(snapshot.conversation.status, "idle");
    assert.equal(snapshot.conversation.parentConversationId, null);
    assert.equal(snapshot.children.length, 0);
    assert.equal(snapshot.config.workingDirectory, f.directory);

    const path = pathOf(f.opts, id);
    // user, assistant, read, sub, end + notice; "evt_side" stays behind.
    assert.equal(path.length, 6);
    assert.deepEqual(
      path.map((event) => event.sequence),
      [1, 2, 3, 4, 5, 6],
    );
    assert.equal(f.opts.storage.events.since(id, 0).length, 6);
    assert.ok(path.every((event) => event.id.startsWith("evt_")));
    assert.ok(path.every((event) => event.id !== "evt_side"));
    assert.ok(path.every((event) => event.inputId === null));
    assert.equal(snapshot.conversation.headEventId, path.at(-1)!.id);
    assert.equal(snapshot.conversation.lastUserMessageAt, at);

    // Tool responses stay paired with their (new) assistant event.
    const sourceMessages = buildModelMessages(
      f.opts.storage.events.pathTo("src", f.forkPoint),
    );
    const messages = buildModelMessages(path);
    const normalize = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value)
          .replaceAll(`conversations/src/`, "conversations/FORK/")
          .replaceAll(`conversations/${id}/`, "conversations/FORK/")
          .replaceAll(
            `conversations/kid/reports/`,
            "conversations/FORK/reports/",
          ),
      ) as unknown;
    assert.deepEqual(
      normalize(messages.slice(0, -1)),
      normalize(sourceMessages),
    );
    const notice = path.at(-1)!;
    assert.equal(notice.type, "system_event");
    assert.deepEqual(notice.payload, {
      subtype: "fork",
      sourceConversationId: "src",
      sourceTitle: "Plan",
      subagents: ["explore-auth"],
      text: "Forked from «Plan». Sub-agents from before this point (explore-auth) are not available in this conversation. Using one of those names starts a new agent without its earlier context.",
    });
    assert.match(JSON.stringify(messages.at(-1)), /not a user request/);

    // Assets: new ID, path in the fork, readable, source row untouched.
    const [asset] = f.opts.storage.assets.list(id);
    assert.notEqual(asset.id, f.resultAssetId);
    assert.equal(
      asset.logicalPath,
      `conversations/${id}/tool-calls/tool1/result.json`,
    );
    assert.equal(
      path.find((event) => event.type === "tool_call_response")?.payload
        .assetIds[0],
      asset.id,
    );
    assert.equal(
      (await f.core.assets.read(asset.id)).toString(),
      '{"ok":true}',
    );
    assert.equal(
      await readFile(
        join(
          f.directory,
          "conversations",
          id,
          "tool-calls/tool1/files/out.txt",
        ),
        "utf8",
      ),
      "artifact",
    );
    // The sub-agent report is copied and the text points at the copy.
    assert.equal(
      await readFile(
        join(f.directory, "conversations", id, "reports/exec1.md"),
        "utf8",
      ),
      "full report",
    );
    assert.match(
      JSON.stringify(path[3]!.payload),
      new RegExp(`conversations/${id}/reports/exec1.md`),
    );

    assert.deepEqual(f.opts.storage.events.since("src", 0), sourceEvents);
    assert.deepEqual(f.opts.storage.assets.list("src"), sourceAssets);
    assert.equal(
      f.opts.storage.conversations.get("src")!.headEventId,
      f.sideBranch,
    );
    // The fork's agent configuration is the source's.
    assert.deepEqual(
      f.opts.configuration.snapshot(id),
      f.opts.configuration.snapshot("src"),
    );

    // Forking again numbers the title past the first fork.
    const again = await f.core.fork(id, path.at(-1)!.id);
    assert.equal(again.conversation.title, "F2: Plan");
  } finally {
    await f.core.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

void test("fork is rejected while work is unfinished, for sub-agents and for foreign events", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.core.fork("kid", f.forkPoint), /Sub-agent/);
    await assert.rejects(f.core.fork("kid", "evt_missing"), /Sub-agent/);
    await assert.rejects(
      f.core.fork("src", "evt_missing"),
      /another conversation/,
    );
    f.opts.storage.toolCalls.insert({
      id: "tool_open",
      conversationId: "src",
      turnId: "turn",
      providerCallId: null,
      assistantEventId: null,
      contentIndex: null,
      origin: "user",
      toolName: "bash",
      arguments: {},
      state: "ready",
      supervision: null,
      interaction: null,
      executionClaim: null,
      updatedAt: at,
    });
    await assert.rejects(f.core.fork("src", f.forkPoint), /unfinished/);
  } finally {
    await f.core.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

void test("a failed fork leaves no rows and no directory", async () => {
  const f = await fixture();
  try {
    const before = f.opts.storage.conversations.listAll().length;
    f.opts.storage.references.copy = () => {
      throw new Error("boom");
    };
    await assert.rejects(f.core.fork("src", f.forkPoint), /boom/);
    assert.equal(f.opts.storage.conversations.listAll().length, before);
    assert.deepEqual(
      (await readdir(join(f.directory, "conversations"))).sort(),
      ["kid", "src"],
    );
    assert.equal(
      f.opts.storage.events.since("src", 0).length,
      6,
      "source events are unchanged",
    );
  } finally {
    await f.core.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

void test("fork titles take the next free F-number after stripping a prefix", () => {
  assert.equal(forkTitle("Plan", ["Plan"]), "F1: Plan");
  assert.equal(forkTitle("Plan", ["Plan", "F1: Plan"]), "F2: Plan");
  assert.equal(forkTitle("F1: Plan", ["Plan", "F1: Plan"]), "F2: Plan");
  assert.equal(
    forkTitle("Plan", ["Plan", "F2: Plan", "F1: Other", "F1: Plan B"]),
    "F1: Plan",
  );
});

void test("startup removes only well-formed conversation directories without a row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "conv-fork-sweep-"));
  const unexpected = async (): Promise<never> => {
    throw new Error("No execution expected");
  };
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    { resolve: unexpected },
    { execute: unexpected, isReplaySafe: () => false },
  );
  const core = new ConversationCore(opts);
  const kept = "conv_01M6VKMDHZMJ7ST028DS44PNCQ";
  const orphan = "conv_01M6VKMDHZMJ7ST028DS44PNCR";
  try {
    await core.projects.create({
      id: "proj_test",
      name: "Test",
      directory: tmpdir(),
    });
    await core.createConversation({ id: kept, projectId: "proj_test" });
    for (const name of [kept, orphan, "01M2052ZRJ4SCC04VYXTGM02AV", "notes"]) {
      await mkdir(join(directory, "conversations", name), { recursive: true });
      await writeFile(join(directory, "conversations", name, "file"), "x");
    }
    await core.start();
    const exists = (name: string) =>
      stat(join(directory, "conversations", name)).then(
        () => true,
        () => false,
      );
    assert.equal(await exists(orphan), false);
    for (const name of [kept, "01M2052ZRJ4SCC04VYXTGM02AV", "notes"])
      assert.equal(await exists(name), true, name);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
