import type { Mode } from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeComposerSlashCommand,
  type ComposerSlashCommandActions,
} from "./composer-slash-command";

function actions(calls: string[]): ComposerSlashCommandActions {
  return {
    clearComposer: () => calls.push("clear"),
    setMode: (mode: Mode) => calls.push(`mode:${mode}`),
    compact: async () => {
      calls.push("compact:start");
      await Promise.resolve();
      calls.push("compact:done");
    },
    abort: async () => {
      calls.push("abort:start");
      await Promise.resolve();
      calls.push("abort:done");
    },
  };
}

describe("composer slash command dispatch", () => {
  it("clears and switches modes without sending a prompt", async () => {
    for (const [command, mode] of [
      ["/plan", "planning"],
      ["/code", "coding"],
    ] as const) {
      const calls: string[] = [];
      assert.equal(
        await executeComposerSlashCommand(command, actions(calls)),
        true,
      );
      assert.deepEqual(calls, ["clear", `mode:${mode}`]);
    }
  });

  it("clears before awaiting compaction and abort actions", async () => {
    for (const command of ["/compact", "/abort"] as const) {
      const calls: string[] = [];
      assert.equal(
        await executeComposerSlashCommand(command, actions(calls)),
        true,
      );
      assert.deepEqual(calls, [
        "clear",
        `${command.slice(1)}:start`,
        `${command.slice(1)}:done`,
      ]);
    }
  });

  it("leaves ordinary prompts untouched", async () => {
    for (const text of ["/status", "/plan inspect first", "normal prompt"]) {
      const calls: string[] = [];
      assert.equal(
        await executeComposerSlashCommand(text, actions(calls)),
        false,
      );
      assert.deepEqual(calls, []);
    }
  });
});
