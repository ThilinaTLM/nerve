import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSubagentTask } from "./subagent-task";

const prompt = (assignments: unknown) => ({
  toolName: "subagent_prompt",
  arguments: { context: "shared", assignments },
});

describe("deriveSubagentTask", () => {
  it("shows the latest matching follow-up without borrowing another child's prompt", () => {
    const calls = [
      prompt([
        {
          name: "auth-research",
          profile: "explore",
          prompt: "Research authentication",
        },
        {
          name: "token-store",
          profile: "developer",
          prompt: "Implement persistence",
        },
      ]),
      prompt([{ name: "auth-research", prompt: "Review the refresh flow" }]),
      prompt([{ name: "another-agent", prompt: "Unrelated follow-up" }]),
    ];
    assert.equal(
      deriveSubagentTask(" Auth-Research ", calls),
      "Review the refresh flow",
    );
    assert.equal(
      deriveSubagentTask("token-store", calls),
      "Implement persistence",
    );
    assert.equal(deriveSubagentTask("unknown", calls), undefined);
  });
  it("ignores malformed assignments and empty prompts", () => {
    assert.equal(
      deriveSubagentTask("a", [
        prompt([{ name: "a", prompt: "Initial prompt" }]),
        prompt([null, { name: "a", prompt: 42 }, { name: "a", prompt: "  " }]),
        prompt(null),
        {
          toolName: "bash",
          arguments: {
            assignments: [{ name: "a", prompt: "Not a subagent assignment" }],
          },
        },
      ]),
      "Initial prompt",
    );
    assert.equal(
      deriveSubagentTask(undefined, [
        prompt([{ name: "a", prompt: "Prompt" }]),
      ]),
      undefined,
    );
  });
});
