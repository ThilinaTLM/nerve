import assert from "node:assert/strict";
import test from "node:test";
import {
  initialCommandPreparation,
  prepareCommands,
} from "./command-preparation.js";
import type { ProcessPort } from "../ports.js";

void test("command blocks run with their conversation identity and retain their prepared results", async () => {
  const text = "Research\n```!!!\necho first\n```\n```!!!\necho second\n```";
  const preparation = initialCommandPreparation(text)!;
  const runs: Parameters<ProcessPort["run"]>[0][] = [];
  let preparedText: string | undefined;
  const signal = new AbortController().signal;
  await prepareCommands({
    conversationId: "conv_commands",
    text,
    preparation,
    cwd: "/project/nested",
    signal,
    processes: {
      async start() {
        throw new Error("No start expected");
      },
      async reattach() {
        return null;
      },
      async run(input) {
        runs.push(input);
        return {
          stdout: `Output for ${input.command}`,
          stderr: "",
          exitCode: 0,
        };
      },
    },
    save(_preparation, text) {
      if (text !== undefined) preparedText = text;
      return true;
    },
  });
  assert.deepEqual(
    runs.map(({ conversationId, command, cwd }) => ({
      conversationId,
      command,
      cwd,
    })),
    [
      {
        conversationId: "conv_commands",
        command: "echo first",
        cwd: "/project/nested",
      },
      {
        conversationId: "conv_commands",
        command: "echo second",
        cwd: "/project/nested",
      },
    ],
  );
  assert.ok(runs.every((run) => run.signal === signal));
  assert.ok(preparation.blocks.every((block) => block.state === "completed"));
  assert.match(preparedText!, /Output for echo first/);
  assert.match(preparedText!, /Output for echo second/);
});
