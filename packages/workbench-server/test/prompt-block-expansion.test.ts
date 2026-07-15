import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolExecutionResult } from "@nervekit/host-runtime/tools";
import { expandExecutablePromptBlocks } from "../src/domains/agents/run/prompt-block-expansion.js";

function executor(
  outputs: Record<string, string>,
  executed: string[] = [],
): (
  command: string,
  options: { signal?: AbortSignal },
) => Promise<ToolExecutionResult> {
  return async (command) => {
    executed.push(command);
    return { content: outputs[command] ?? "", exitCode: 0 };
  };
}

describe("expandExecutablePromptBlocks", () => {
  it("returns the same request when the prompt has no blocks", async () => {
    const request = { text: "Just a question about ```code``` blocks." };
    const expanded = await expandExecutablePromptBlocks(
      executor({}),
      request,
      new AbortController().signal,
    );
    assert.equal(expanded, request);
  });

  it("replaces every block with its formatted result in order", async () => {
    const executed: string[] = [];
    const request = {
      text: [
        "Compare these:",
        "```!!!",
        "printf one",
        "```",
        "and",
        "```!!!",
        "printf two",
        "```",
      ].join("\n"),
    };
    const expanded = await expandExecutablePromptBlocks(
      executor({ "printf one": "one", "printf two": "two" }, executed),
      request,
      new AbortController().signal,
    );
    assert.deepEqual(executed, ["printf one", "printf two"]);
    assert.doesNotMatch(expanded.text, /```!!!/);
    assert.match(
      expanded.text,
      /```\n\$ printf one\n\n> exit code: 0, status: completed\none\n```/,
    );
    assert.match(
      expanded.text,
      /```\n\$ printf two\n\n> exit code: 0, status: completed\ntwo\n```/,
    );
  });

  it("stops expanding when the signal aborts between blocks", async () => {
    const controller = new AbortController();
    const executed: string[] = [];
    const request = {
      text: "```!!!\nfirst\n```\n```!!!\nsecond\n```",
    };
    await assert.rejects(
      expandExecutablePromptBlocks(
        async (command): Promise<ToolExecutionResult> => {
          executed.push(command);
          controller.abort();
          return { content: "", exitCode: 0 };
        },
        request,
        controller.signal,
      ),
      /Command execution aborted/,
    );
    assert.deepEqual(executed, ["first"]);
  });
});
