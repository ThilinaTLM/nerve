import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolCardLayoutRevision } from "./tool-card-layout";

describe("toolCardLayoutRevision", () => {
  it("changes for lifecycle, activity, badge, and argument-shape milestones", () => {
    const base = {
      stage: "drafting" as const,
      activityRevision: "no-arg|result:none",
      badge: "write",
      arg: { text: "draft", openPath: "/tmp/a" },
    };
    const revision = toolCardLayoutRevision(base);

    assert.notEqual(
      toolCardLayoutRevision({ ...base, stage: "executing" }),
      revision,
    );
    assert.notEqual(
      toolCardLayoutRevision({ ...base, activityRevision: "arg|result:none" }),
      revision,
    );
    assert.notEqual(
      toolCardLayoutRevision({ ...base, badge: "edit" }),
      revision,
    );
    assert.notEqual(
      toolCardLayoutRevision({ ...base, arg: { text: "draft" } }),
      revision,
    );
  });

  it("ignores raw streamed argument text when its shape is stable", () => {
    const common = {
      stage: "drafting" as const,
      activityRevision: "arg|result:none",
      badge: "write",
    };
    assert.equal(
      toolCardLayoutRevision({ ...common, arg: { text: "a" } }),
      toolCardLayoutRevision({
        ...common,
        arg: { text: "a much longer streamed value" },
      }),
    );
  });
});
