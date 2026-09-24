import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exploreRunPlanArg } from "../../../src/domains/agents/execution/explore-helpers.js";

const context =
  "The parent grepped the settings package and still needs the patch flow.";

describe("exploreRunPlanArg", () => {
  it("requires a short label for every task", () => {
    assert.throws(
      () =>
        exploreRunPlanArg({
          context,
          tasks: [{ task: "Trace how settings patches are persisted." }],
        }),
      /Explore task 1 requires 'label'/,
    );
  });

  it("normalizes label whitespace", () => {
    const plan = exploreRunPlanArg({
      context,
      tasks: [
        {
          task: "Trace how settings patches are persisted.",
          label: "  Settings   patch flow ",
        },
      ],
    });
    assert.equal(plan.tasks[0]?.label, "Settings patch flow");
  });
});
