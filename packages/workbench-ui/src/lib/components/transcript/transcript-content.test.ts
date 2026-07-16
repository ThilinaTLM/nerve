import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasTranscriptContent } from "./transcript-content";

const empty = {
  timelineLength: 0,
  streamingText: "",
  sending: false,
  queuedPromptCount: 0,
};

describe("hasTranscriptContent", () => {
  it("returns false for an idle empty transcript", () => {
    assert.equal(hasTranscriptContent(empty), false);
  });

  it("recognizes timeline and streaming content", () => {
    assert.equal(hasTranscriptContent({ ...empty, timelineLength: 1 }), true);
    assert.equal(
      hasTranscriptContent({ ...empty, streamingText: "Working" }),
      true,
    );
  });

  it("recognizes a sending-only waiting row", () => {
    assert.equal(hasTranscriptContent({ ...empty, sending: true }), true);
  });

  it("recognizes a queued prompt without other transcript content", () => {
    assert.equal(
      hasTranscriptContent({ ...empty, queuedPromptCount: 1 }),
      true,
    );
  });
});
