import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatElapsed, operationLines } from "./tool-presentation-helpers";

describe("formatElapsed", () => {
  it("counts seconds for short work", () => {
    assert.equal(formatElapsed(0), "0s");
    assert.equal(formatElapsed(2_400), "2s");
    assert.equal(formatElapsed(59_900), "59s");
  });

  it("switches to a stopwatch once a minute passes", () => {
    assert.equal(formatElapsed(60_000), "1:00");
    assert.equal(formatElapsed(125_000), "2:05");
    assert.equal(formatElapsed(59 * 60_000 + 59_000), "59:59");
  });

  it("adds hours for very long work", () => {
    assert.equal(formatElapsed(3_600_000), "1:00:00");
    assert.equal(formatElapsed(3_725_000), "1:02:05");
  });
});

it("operationLines shows operation · target, one line per target", () => {
  assert.deepEqual(
    operationLines([
      {
        operation: "jira.comments.add",
        targets: ["jira:issue/SCRUM-1", "jira:issue/SCRUM-2"],
        targetsKnown: true,
        count: 2,
      },
      {
        operation: "jira.issues.get",
        targets: [],
        targetsKnown: false,
        count: 3,
      },
      {
        operation: "jira.issues.update",
        targets: ["jira:issue/A-1"],
        targetsKnown: false,
        count: 1,
      },
    ]),
    [
      "jira.comments.add · jira:issue/SCRUM-1",
      "jira.comments.add · jira:issue/SCRUM-2",
      "jira.issues.get ×3",
      "jira.issues.update · jira:issue/A-1",
      "jira.issues.update · other targets",
    ],
  );
});
