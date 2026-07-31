import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveComposerAvailability } from "./composer-availability";

const ready = {
  interactive: true,
  hasProject: true,
  hasConversation: true,
  hasModels: true,
  blockedForReview: false,
  compacting: false,
  stopping: false,
  sending: false,
  commandMode: false,
  voiceSubmitPending: false,
};

describe("composer availability", () => {
  it("allows drafting while models are still loading", () => {
    const availability = deriveComposerAvailability({
      ...ready,
      hasModels: false,
    });

    assert.equal(availability.canEdit, true);
    assert.equal(availability.canPrompt, false);
    assert.equal(availability.canSubmit, false);
  });

  it("allows editing and submission when the target and models are ready", () => {
    const availability = deriveComposerAvailability(ready);

    assert.equal(availability.hasTarget, true);
    assert.equal(availability.canEdit, true);
    assert.equal(availability.canSubmit, true);
  });

  it("blocks editing without an active target or interactive pane", () => {
    for (const patch of [
      { interactive: false },
      { hasProject: false },
      { hasConversation: false },
    ]) {
      const availability = deriveComposerAvailability({ ...ready, ...patch });
      assert.equal(availability.canEdit, false);
      assert.equal(availability.canSubmit, false);
    }
  });

  it("blocks editing during reviews, compaction, and stopping", () => {
    for (const patch of [
      { blockedForReview: true },
      { compacting: true },
      { stopping: true },
    ]) {
      const availability = deriveComposerAvailability({ ...ready, ...patch });
      assert.equal(availability.canEdit, false);
      assert.equal(availability.canSubmit, false);
    }
  });

  it("keeps a running non-command prompt editable and queueable", () => {
    const availability = deriveComposerAvailability({
      ...ready,
      sending: true,
    });

    assert.equal(availability.canEdit, true);
    assert.equal(availability.canSubmit, true);
  });

  it("does not run commands or submit while voice transcription is pending", () => {
    assert.equal(
      deriveComposerAvailability({
        ...ready,
        sending: true,
        commandMode: true,
      }).canSubmit,
      false,
    );
    assert.equal(
      deriveComposerAvailability({
        ...ready,
        voiceSubmitPending: true,
      }).canSubmit,
      false,
    );
  });
});
