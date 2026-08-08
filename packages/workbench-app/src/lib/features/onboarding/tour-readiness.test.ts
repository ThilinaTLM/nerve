import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeTabIsConversation,
  deferredTourCanContinue,
  needsProjectForTour,
} from "./tour-readiness.js";

describe("onboarding tour readiness", () => {
  it("requires a project before starting", () => {
    assert.equal(needsProjectForTour(false), true);
    assert.equal(needsProjectForTour(true), false);
  });

  it("continues a deferred tour only after project selection closes the picker", () => {
    const base = { awaitingProject: true, hasActiveProject: true };
    assert.equal(
      deferredTourCanContinue({ ...base, projectPickerOpen: true }),
      false,
    );
    assert.equal(
      deferredTourCanContinue({ ...base, projectPickerOpen: false }),
      true,
    );
    assert.equal(
      deferredTourCanContinue({
        awaitingProject: true,
        hasActiveProject: false,
        projectPickerOpen: false,
      }),
      false,
    );
  });

  it("accepts pending and saved conversations as composer-ready", () => {
    assert.equal(activeTabIsConversation("pending-conversation"), true);
    assert.equal(activeTabIsConversation("conversation"), true);
    assert.equal(activeTabIsConversation("file"), false);
    assert.equal(activeTabIsConversation(undefined), false);
  });
});
