import assert from "node:assert/strict";
import { test } from "node:test";
import { completionSourceState } from "../../../src/domains/completions/completion-source-state.js";

void test("every source identifies its exact popup group throughout the loading lifecycle", () => {
  const mappings = {
    files: "files",
    pull_requests: "pull_requests",
    issues: "issues",
    skills: "skills",
    tools: "tools",
    profiles: "agents",
    subagents: "agents",
    launches: "launches",
    launch_definitions: "launches",
  };
  for (const [source, group] of Object.entries(mappings)) {
    for (const status of [
      "loading",
      "fresh",
      "stale",
      "unavailable",
    ] as const) {
      assert.deepEqual(
        completionSourceState({ source, status }).groups,
        [group],
        `${source}: ${status}`,
      );
    }
  }
});

void test("stale sources retain specific owner failures while unknown load errors do not invent settings actions", () => {
  const stale = completionSourceState({
    source: "pull_requests",
    status: "stale",
    reason: "GitHub CLI isn’t signed in.",
    action: "open_pull_requests",
  });
  assert.equal(stale.reason, "GitHub CLI isn’t signed in.");
  assert.equal(stale.action, "open_pull_requests");
  for (const source of ["skills", "tools", "profiles"]) {
    const unavailable = completionSourceState({
      source,
      status: "unavailable",
    });
    assert.match(unavailable.reason!, /couldn’t be loaded/);
    assert.equal(unavailable.action, undefined);
  }
});
