import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendTranscriptText,
  type VoiceInputTarget,
  voiceInputTargetsEqual,
} from "./voice-input-target";

describe("voice input target helpers", () => {
  it("appends transcript text with composer spacing", () => {
    assert.equal(appendTranscriptText("", " hello "), "hello");
    assert.equal(
      appendTranscriptText("existing", " next "),
      "existing\n\nnext",
    );
    assert.equal(
      appendTranscriptText("existing\n", " next "),
      "existing\nnext",
    );
    assert.equal(appendTranscriptText("existing ", " next "), "existing next");
  });

  it("ignores empty transcripts", () => {
    assert.equal(appendTranscriptText("existing", "   \n"), "existing");
  });

  it("compares targets by kind and id", () => {
    const conversation: VoiceInputTarget = { kind: "conversation", id: "c1" };
    assert.equal(
      voiceInputTargetsEqual(conversation, { kind: "conversation", id: "c1" }),
      true,
    );
    assert.equal(
      voiceInputTargetsEqual(conversation, { kind: "conversation", id: "c2" }),
      false,
    );
    assert.equal(
      voiceInputTargetsEqual(conversation, {
        kind: "pending-conversation",
        id: "c1",
      }),
      false,
    );
    assert.equal(voiceInputTargetsEqual(conversation, undefined), false);
  });
});
