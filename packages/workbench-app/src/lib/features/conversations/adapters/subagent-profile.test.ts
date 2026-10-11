import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveSubagentProfile } from "./subagent-profile";

const prompt = (assignments: unknown) => ({
  toolName: "subagent_prompt",
  arguments: { context: "shared", assignments },
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
