import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionSoundEvent,
  classifyPresence,
  createSoundThrottle,
  decideDelivery,
  mostUrgent,
  type AttentionInputKind,
} from "./attention-policy";

const base = { focused: true, lastInputAt: 1_000, now: 1_000, viewing: true };

test("presence: watching, elsewhere and away", () => {
  assert.equal(classifyPresence(base), "watching");
  assert.equal(classifyPresence({ ...base, viewing: false }), "elsewhere");
  assert.equal(classifyPresence({ ...base, focused: false }), "away");
  assert.equal(classifyPresence({ ...base, now: 1_000 + 59_999 }), "watching");
  assert.equal(classifyPresence({ ...base, now: 1_000 + 60_000 }), "away");
});

test("delivery per presence and mute", () => {
  assert.deepEqual(decideDelivery("watching", false), {
    surface: "none",
    sound: false,
  });
  assert.deepEqual(decideDelivery("elsewhere", false), {
    surface: "toast",
    sound: true,
  });
  assert.deepEqual(decideDelivery("away", false), {
    surface: "system",
    sound: true,
  });
  assert.deepEqual(decideDelivery("away", true), {
    surface: "none",
    sound: false,
  });
});

test("sound event mapping", () => {
  const input = (inputKind: AttentionInputKind) =>
    attentionSoundEvent({ kind: "input", inputKind });
  assert.equal(input("approval"), "approval");
  assert.equal(input("configuration_blocked"), "approval");
  assert.equal(input("user_input"), "question");
  assert.equal(input("plan_review"), "planReview");
  assert.equal(attentionSoundEvent({ kind: "finished" }), "completed");
  assert.equal(attentionSoundEvent({ kind: "failed" }), "failed");
  assert.equal(attentionSoundEvent({ kind: "interrupted" }), "failed");
});

test("most urgent coinciding event wins: input > failure > finished", () => {
  assert.equal(
    mostUrgent([{ kind: "finished" }, { kind: "failed" }, { kind: "input" }])
      ?.kind,
    "input",
  );
  assert.equal(
    mostUrgent([{ kind: "finished" }, { kind: "interrupted" }])?.kind,
    "interrupted",
  );
  assert.equal(mostUrgent([]), undefined);
});

test("sound throttle allows one sound per interval", () => {
  const throttle = createSoundThrottle(4_000);
  assert.equal(throttle.tryAcquire(10_000), true);
  assert.equal(throttle.tryAcquire(13_999), false);
  assert.equal(throttle.tryAcquire(14_000), true);
});
