import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type VoiceInputTarget,
  voiceInputTargetKey,
} from "../../../features/conversations/audio/voice-input-target";
import { bindComposerVoiceInput } from "./composer-voice-input";

function harness(initial = "") {
  const handlers = new Map<
    string,
    { appendTranscript: (text: string) => void }
  >();
  let text = initial;
  let focusCount = 0;
  const session = {
    registerTargetHandlers(
      target: VoiceInputTarget,
      handler: { appendTranscript: (text: string) => void },
    ) {
      const key = voiceInputTargetKey(target);
      handlers.set(key, handler);
      return () => {
        if (handlers.get(key) === handler) handlers.delete(key);
      };
    },
  };
  return {
    bind: (target: VoiceInputTarget) =>
      bindComposerVoiceInput(session, target, {
        read: () => text,
        update: (next) => {
          text = next;
        },
        focus: () => {
          focusCount += 1;
        },
      }),
    deliver: (target: VoiceInputTarget, transcript: string) =>
      handlers.get(voiceInputTargetKey(target))?.appendTranscript(transcript),
    edit: (next: string) => {
      text = next;
    },
    get text() {
      return text;
    },
    get focusCount() {
      return focusCount;
    },
  };
}

for (const kind of ["conversation", "pending-conversation"] as const) {
  test(`delivers ${kind} transcription to the draft before submission`, () => {
    const composer = harness();
    const target = { kind, id: "one" };
    composer.bind(target);
    composer.deliver(target, "  Spoken prompt  ");
    const submitted = composer.text;
    assert.equal(submitted, "Spoken prompt ");
    assert.equal(composer.focusCount, 1);
  });
}

test("appends to the latest draft, including edits made during recording", () => {
  const composer = harness("Original draft");
  const target = { kind: "conversation", id: "one" } as const;
  composer.bind(target);
  composer.edit("Edited draft");
  composer.deliver(target, "First recording");
  assert.equal(composer.text, "Edited draft\n\nFirst recording ");
  composer.deliver(target, "Second recording");
  assert.equal(
    composer.text,
    "Edited draft\n\nFirst recording Second recording ",
  );
  assert.equal(composer.focusCount, 2);
});

test("blank transcription leaves the draft and focus unchanged", () => {
  const composer = harness("Keep this");
  const target = { kind: "conversation", id: "one" } as const;
  composer.bind(target);
  composer.deliver(target, " \n\t ");
  assert.equal(composer.text, "Keep this");
  assert.equal(composer.focusCount, 0);
});

test("target changes and cleanup prevent delivery into the wrong draft", () => {
  const composer = harness();
  const oldTarget = { kind: "pending-conversation", id: "one" } as const;
  const newTarget = { kind: "conversation", id: "one" } as const;
  const unregisterOld = composer.bind(oldTarget);
  composer.deliver(newTarget, "Wrong target");
  assert.equal(composer.text, "");
  unregisterOld();
  const unregisterNew = composer.bind(newTarget);
  composer.deliver(oldTarget, "Late old result");
  assert.equal(composer.text, "");
  composer.deliver(newTarget, "New result");
  assert.equal(composer.text, "New result ");
  unregisterNew();
  composer.deliver(newTarget, "After unmount");
  assert.equal(composer.text, "New result ");
  assert.equal(composer.focusCount, 1);
});
