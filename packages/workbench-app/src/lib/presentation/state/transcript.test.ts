import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInlineCommandResultText } from "@nervekit/contracts/completions";
import type { ConversationEntry } from "../view-models/conversation";
import { segmentUserMessageText } from "../transcript/user-message-content";
import { entryToTranscriptItem, entryToTranscriptItems } from "./transcript";

const entry: ConversationEntry = {
  id: "evt-test",
  conversationId: "conversation-test",
  role: "user",
  kind: "message",
  text: "```!!!\ngit status --short --branch\n```\nOpen a pull request.",
  createdAt: "2026-10-12T04:43:42Z",
};

test("user command results reach display without replacing the original prompt", () => {
  const preparedText = `${formatInlineCommandResultText({
    command: "git status --short --branch",
    status: "completed",
    exitCode: 0,
    output: "## feature/commands",
  })}\nOpen a pull request.`;
  const item = entryToTranscriptItem({
    ...entry,
    details: { preparedText },
  });
  assert.ok(item);
  assert.equal(item.text, entry.text);
  assert.equal(item.preparedText, preparedText);
  assert.deepEqual(segmentUserMessageText(item.preparedText ?? item.text), [
    {
      kind: "command_result",
      command: "git status --short --branch",
      status: "completed",
      exitCode: 0,
      output: "## feature/commands",
    },
    { kind: "text", text: "Open a pull request." },
  ]);
});

test("missing or malformed prepared text keeps raw command prompts", () => {
  for (const details of [undefined, null, {}, { preparedText: 42 }]) {
    const item = entryToTranscriptItem({ ...entry, details });
    assert.ok(item);
    assert.equal(item.preparedText, undefined);
    assert.equal(
      segmentUserMessageText(item.preparedText ?? item.text)[0].kind,
      "command_pending",
    );
  }
});

test("empty prepared text is preserved", () => {
  assert.equal(
    entryToTranscriptItem({ ...entry, details: { preparedText: "" } })
      ?.preparedText,
    "",
  );
});

test("prepared user text is not applied to assistant, thinking or system items", () => {
  for (const role of ["assistant", "system"] as const) {
    const items = entryToTranscriptItems({
      ...entry,
      role,
      details: {
        preparedText: "expanded",
        thinkingBlocks: [{ text: "thinking" }],
      },
    });
    for (const item of items) assert.equal(item.preparedText, undefined);
  }
});
