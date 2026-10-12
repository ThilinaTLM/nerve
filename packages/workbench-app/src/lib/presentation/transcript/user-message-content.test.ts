import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInlineCommandResultText } from "@nervekit/contracts/completions";
import type {
  CommandPreparation,
  CommandPreparationState,
} from "@nervekit/contracts/core";
import {
  segmentUserMessageText,
  userCommandPresentation,
} from "./user-message-content";

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

test("per-command preparation spins only the running command in a mixed prompt", () => {
  const preparation: CommandPreparation = {
    blocks: [
      {
        index: 0,
        command: "first",
        state: "completed",
        result: { stdout: "out", stderr: "err", exitCode: 1 },
      },
      { index: 1, command: "second", state: "running", result: null },
      { index: 2, command: "third", state: "not_started", result: null },
    ],
  };
  const commands = segmentUserMessageText(
    "Before\n```!!!\nfirst\n```\nBetween\n```!!!\nsecond\n```\n```!!!\nthird\n```",
  ).filter((segment) => segment.kind !== "text");
  const presentations = commands.map((segment, index) =>
    userCommandPresentation(segment, index, true, preparation),
  );
  assert.deepEqual(
    presentations.map((command) => command.phase),
    ["done", "running", "static"],
  );
  assert.equal(presentations[0].exitCode, 1);
  assert.equal(presentations[0].output, "out\nerr");
});

test("settled and interrupted commands never retain an optimistic spinner", () => {
  const states: CommandPreparationState[] = [
    "completed",
    "cancelled",
    "indeterminate",
    "not_run",
  ];
  for (const state of states) {
    const presentation = userCommandPresentation(
      { kind: "command_pending", command: "test" },
      0,
      true,
      { blocks: [{ index: 0, command: "test", state, result: null }] },
    );
    assert.equal(presentation.phase, "done", state);
    assert.equal(presentation.status, state);
  }
});

test("optimism is only a fallback when command preparation is absent", () => {
  const segment = { kind: "command_pending", command: "test" } as const;
  assert.equal(userCommandPresentation(segment, 0, true).phase, "running");
  assert.equal(userCommandPresentation(segment, 0, false).phase, "static");
  assert.equal(
    userCommandPresentation(segment, 0, true, { blocks: [] }).phase,
    "static",
  );
});

test("queued commands spin from running metadata without optimism", () => {
  assert.equal(
    userCommandPresentation(
      { kind: "command_pending", command: "test" },
      0,
      false,
      {
        blocks: [{ index: 0, command: "test", state: "running", result: null }],
      },
    ).phase,
    "running",
  );
});

test("recorded results stay settled even with stale running metadata", () => {
  const segments = segmentUserMessageText(
    formatInlineCommandResultText({
      command: "test",
      status: "cancelled",
      output: "",
    }),
  );
  const segment = segments[0];
  assert.notEqual(segment.kind, "text");
  if (segment.kind === "text") return;
  assert.equal(
    userCommandPresentation(segment, 0, true, {
      blocks: [{ index: 0, command: "test", state: "running", result: null }],
    }).phase,
    "done",
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
