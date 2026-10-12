import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSubagentProfile, deriveSubagentTask } from "./subagent-profile";

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

describe("deriveSubagentProfile", () => {
  it("matches the assignment by the child's title", () => {
    const call = prompt([
      { name: "auth-research", profile: "explore", prompt: "a" },
      { name: "token-store", profile: "developer", prompt: "b" },
    ]);
    assert.equal(deriveSubagentProfile("token-store", call), "developer");
    assert.equal(deriveSubagentProfile("Auth-Research", call), "explore");
  });

  it("is unknown for follow-ups without a profile or other names", () => {
    const call = prompt([{ name: "a", prompt: "x" }]);
    assert.equal(deriveSubagentProfile("a", call), undefined);
    assert.equal(deriveSubagentProfile("b", call), undefined);
    assert.equal(deriveSubagentProfile("a", prompt("nope")), undefined);
  });

  it("maps legacy spawning tools", () => {
    assert.equal(
      deriveSubagentProfile("x", { toolName: "explore", arguments: {} }),
      "explore",
    );
    assert.equal(
      deriveSubagentProfile("x", { toolName: "subagent_new", arguments: {} }),
      "developer",
    );
    assert.equal(
      deriveSubagentProfile("x", { toolName: "bash", arguments: {} }),
      undefined,
    );
    assert.equal(deriveSubagentProfile("x", undefined), undefined);
  });
});
