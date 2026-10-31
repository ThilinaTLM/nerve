import assert from "node:assert/strict";
import test from "node:test";
import { openCoreStorage } from "./core-storage.js";
import { extractPromptReferences } from "../conversations/references/github.js";
import { ReferenceExtraction } from "../conversations/references/reference-extraction.js";
import type { ConversationEvent } from "@nervekit/contracts/core";
import type { CoreChange } from "../runtime/core-change.js";
const at = "2026-10-01T00:00:00.000Z";
function fixture() {
  const storage = openCoreStorage(":memory:");
  storage.projects.insert({
    id: "p",
    name: "P",
    directory: "/project",
    createdAt: at,
    updatedAt: at,
  });
  for (const id of ["root", "child", "grandchild", "sibling"])
    storage.conversations.insert(
      {
        id,
        projectId: "p",
        parentConversationId:
          id === "root" ? null : id === "grandchild" ? "child" : "root",
        parentToolCallId: null,
        headEventId: null,
        title: id,
        status: "idle",
        statusEventSequence: 0,
        statusClearedAt: null,
        paused: false,
        nextInputSequence: 1,
        pinnedAt: null,
        completedAt: null,
        lastUserMessageAt: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        conversationId: id,
        model: { provider: "test", modelId: "test" },
        reasoningLevel: "off",
        systemPrompt: null,
        instructions: null,
        permissionRuleSetId: "baseline",
        agentProfile: "coding",
        workingDirectory: "/project",
      },
    );
  return storage;
}
test("upserts are idempotent, upgrade only, preserve first-seen and cascade on deletion", () => {
  const s = fixture();
  try {
    const ref = extractPromptReferences("a/b#1")[0];
    assert(s.references.upsert("root", ref, "first", at));
    assert(!s.references.upsert("root", ref, "repeat", at));
    assert(
      s.references.upsert(
        "root",
        { ...ref, relationship: "created", kind: "pull_request" },
        "upgrade",
        "2026-10-02T00:00:00.000Z",
      ),
    );
    assert(!s.references.upsert("root", ref, "downgrade", at));
    assert(s.references.upsert("sibling", ref, "same-resource", at));
    assert.equal(s.references.load(["root"]).get("root")?.length, 1);
    assert.equal(
      s.references.load(["root"]).get("root")?.[0].relationship,
      "created",
    );
    assert.equal(
      s.references.load(["root"]).get("root")?.[0].kind,
      "pull_request",
    );
    assert.equal(s.conversations.getSummary("root")?.updatedAt, at);
    assert.equal(s.conversations.getSummary("root")?.lastUserMessageAt, null);
    s.conversations.delete("sibling");
    assert.equal(s.references.load(["sibling"]).size, 0);
    s.conversations.delete("root");
    assert.equal(s.references.load(["root"]).size, 0);
  } finally {
    s.close();
  }
});
test("summary references put created first, then first-seen; upgrades retain original order", () => {
  const s = fixture();
  try {
    for (const n of [1, 2, 3])
      s.references.upsert(
        "root",
        extractPromptReferences(`a/b#${n}`)[0],
        `e${n}`,
        `2026-10-0${n}T00:00:00.000Z`,
      );
    s.references.upsert(
      "root",
      { ...extractPromptReferences("PR a/b#1")[0], relationship: "created" },
      "upgrade1",
      "2026-10-10T00:00:00.000Z",
    );
    s.references.upsert(
      "root",
      { ...extractPromptReferences("PR a/b#3")[0], relationship: "created" },
      "upgrade3",
      "2026-10-09T00:00:00.000Z",
    );
    assert.deepEqual(
      s.conversations
        .list({ projectId: "p" })[0]
        .references.map((r) => r.identifier),
      ["1", "3", "2"],
    );
  } finally {
    s.close();
  }
});
function prompt(conversationId: string): ConversationEvent {
  return {
    id: "prompt",
    conversationId,
    sequence: 1,
    previousEventId: null,
    turnId: null,
    inputId: null,
    createdAt: at,
    type: "user_message",
    llmRepresentation: "user",
    payload: {
      text: "system injected a/b#99",
      originalText: "PR a/b#1",
      source: "user",
      senderConversationId: null,
      commandPreparation: null,
    },
  };
}
function bash(conversationId: string): ConversationEvent {
  return {
    id: "created",
    conversationId,
    sequence: 2,
    previousEventId: null,
    turnId: null,
    inputId: null,
    createdAt: at,
    type: "tool_call_response",
    llmRepresentation: "tool_result",
    payload: {
      toolCallId: "tool",
      providerCallId: "call",
      toolName: "bash",
      arguments: { command: "gh pr create" },
      origin: "model",
      assistantEventId: "assistant",
      contentIndex: 0,
      outcome: "completed",
      agentProjection: [],
      userProjection: {
        argsPreview: {},
        resultPreview: {
          content: "https://github.com/a/b/pull/1",
          details: { exitCode: 0 },
        },
      },
      supervision: null,
      interactionResolution: null,
      resolutionRequestId: null,
      assetIds: [],
    },
  };
}
test("committed extraction uses root originalText only, replay is silent, descendant creation also updates root", async () => {
  const s = fixture(),
    changes: CoreChange[] = [];
  const extraction = new ReferenceExtraction({
    storage: s,
    emit: (change) => changes.push(change),
  });
  try {
    await extraction.committed(prompt("child"));
    assert.equal(s.references.load(["child"]).size, 0);
    await extraction.committed(prompt("root"));
    assert.equal(
      s.conversations.getSummary("root")?.references[0].identifier,
      "1",
    );
    const count = changes.length;
    await extraction.committed(prompt("root"));
    assert.equal(changes.length, count);
    await extraction.committed(bash("grandchild"));
    for (const id of ["root", "grandchild"])
      assert.equal(
        s.conversations.getSummary(id)?.references[0].relationship,
        "created",
      );
    for (const id of ["child", "sibling"])
      assert.equal(s.references.load([id]).size, 0);
    assert(changes.every((change) => change.kind === "conversation_changed"));
    assert.equal(s.conversations.getSummary("root")?.updatedAt, at);
  } finally {
    s.close();
  }
});

test("settled async bash extracts output only and records descendant creation on root", async () => {
  const s = fixture();
  const extraction = new ReferenceExtraction({ storage: s, emit: () => {} });
  try {
    const command = "gh issue create --body https://github.com/a/b/issues/99";
    s.asyncBash.insert({
      id: "bash",
      conversationId: "child",
      toolCallId: "tool",
      command,
      workingDirectory: "/project",
      status: "completed",
      processRef: "process",
      exitCode: 0,
      startedAt: at,
      finishedAt: at,
    });
    const event: ConversationEvent = {
      id: "async",
      conversationId: "child",
      sequence: 1,
      previousEventId: null,
      turnId: null,
      inputId: null,
      createdAt: at,
      type: "system_event",
      llmRepresentation: "user",
      payload: {
        subtype: "async_bash_event",
        producer: "bash",
        bashId: "bash",
        status: "completed",
        exitCode: 0,
        text: `${command}\nno URL`,
        assetIds: [],
      },
    };
    await extraction.committed(event);
    assert.equal(s.references.load(["child"]).size, 0);
    if (event.payload.subtype !== "async_bash_event")
      throw new Error("fixture subtype");
    event.payload.text = `${command}\nhttps://github.com/Acme/API/issues/5`;
    await extraction.committed(event);
    assert.equal(
      s.conversations.getSummary("child")?.references[0].identifier,
      "5",
    );
    assert.equal(
      s.conversations.getSummary("root")?.references[0].relationship,
      "created",
    );
    assert.equal(s.conversations.getSummary("sibling")?.references.length, 0);
  } finally {
    s.close();
  }
});

test("summaries derive canonical display casing from identity, not source text", async () => {
  const s = fixture();
  const extraction = new ReferenceExtraction({ storage: s, emit: () => {} });
  try {
    const event = prompt("root");
    if (event.type !== "user_message") throw new Error("fixture type");
    event.payload.originalText = "acme/api#1";
    await extraction.committed(s.events.append(event));
    event.id = "refinement";
    event.payload.originalText = "PR Acme/API#1";
    await extraction.committed(s.events.append(event));
    event.id = "later-mention";
    event.payload.originalText = "acme/api#1";
    await extraction.committed(s.events.append(event));
    assert.equal(
      s.conversations.getSummary("root")?.references[0].container,
      "acme/api",
    );
    assert.equal(
      s.conversations.list({ projectId: "p" })[0].references[0].resourceKey,
      "github.com/acme/api#1",
    );
  } finally {
    s.close();
  }
});

test("remote discovery skips unrelated prompts and settled bash commands", async () => {
  const s = fixture();
  let discoveries = 0;
  const extraction = new ReferenceExtraction({
    storage: s,
    emit: () => {},
    gitRemotes: async () => {
      discoveries++;
      return [];
    },
  });
  try {
    const message = prompt("root");
    if (message.type !== "user_message") throw new Error("fixture type");
    message.payload.originalText = "Please explain this code";
    await extraction.committed(message);
    const response = bash("root");
    if (response.type !== "tool_call_response") throw new Error("fixture type");
    response.payload.arguments.command = "gh pr view";
    await extraction.committed(response);
    s.asyncBash.insert({
      id: "unrelated",
      conversationId: "root",
      toolCallId: "tool",
      command: "pnpm check",
      workingDirectory: "/project",
      status: "completed",
      processRef: "process",
      exitCode: 0,
      startedAt: at,
      finishedAt: at,
    });
    const notice: ConversationEvent = {
      id: "notice",
      conversationId: "root",
      sequence: 1,
      previousEventId: null,
      turnId: null,
      inputId: null,
      createdAt: at,
      type: "system_event",
      llmRepresentation: "user",
      payload: {
        subtype: "async_bash_event",
        producer: "unrelated",
        bashId: "unrelated",
        status: "completed",
        exitCode: 0,
        text: "pnpm check\nOK",
        assetIds: [],
      },
    };
    await extraction.committed(notice);
    assert.equal(discoveries, 0);
    message.payload.originalText = "PR #1";
    await extraction.committed(message);
    message.payload.originalText = "https://github.com/a/b/pull/1";
    await extraction.committed(message);
    response.payload.arguments.command = "gh pr create";
    await extraction.committed(response);
    s.asyncBash.update("unrelated", { command: "gh issue create" });
    await extraction.committed(notice);
    assert.equal(discoveries, 4);
    // A candidate is not sufficient evidence of creation.
    assert.equal(s.conversations.getSummary("root")?.references.length, 1);
  } finally {
    s.close();
  }
});
