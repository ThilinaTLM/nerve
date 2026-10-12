import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInlineCommandResultText } from "@nervekit/contracts/completions";
import { segmentUserMessageText } from "./user-message-content";

test("mixed prose and executed commands retain results including failures and no output", () => {
  const first = formatInlineCommandResultText({
    command: "git status",
    status: "completed",
    exitCode: 0,
    output: "",
  });
  const second = formatInlineCommandResultText({
    command: "git diff --exit-code",
    status: "completed",
    exitCode: 1,
    output: "diff content",
  });
  assert.deepEqual(
    segmentUserMessageText(`Before\n${first}\nBetween\n${second}\nAfter`),
    [
      { kind: "text", text: "Before" },
      {
        kind: "command_result",
        command: "git status",
        status: "completed",
        exitCode: 0,
        output: "",
      },
      { kind: "text", text: "Between" },
      {
        kind: "command_result",
        command: "git diff --exit-code",
        status: "completed",
        exitCode: 1,
        output: "diff content",
      },
      { kind: "text", text: "After" },
    ],
  );
});

test("raw command fences remain pending", () => {
  assert.deepEqual(
    segmentUserMessageText("```!!!\ngit status\n```\nContinue"),
    [
      { kind: "command_pending", command: "git status" },
      { kind: "text", text: "Continue" },
    ],
  );
});

test("executable-looking fences inside recorded output stay in the result", () => {
  const output = "```!!!\necho example\n```";
  const text = formatInlineCommandResultText({
    command: "cat example.md",
    status: "completed",
    exitCode: 0,
    output,
  });
  assert.deepEqual(segmentUserMessageText(text), [
    {
      kind: "command_result",
      command: "cat example.md",
      status: "completed",
      exitCode: 0,
      output,
    },
  ]);
});
