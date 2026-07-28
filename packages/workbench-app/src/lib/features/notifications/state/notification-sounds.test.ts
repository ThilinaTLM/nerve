import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNotificationSoundPlayer } from "./notification-sounds";

type FakeAudio = {
  source: string;
  currentTime: number;
  preload: string;
  loads: number;
  plays: number;
  load: () => void;
  play: () => Promise<void>;
};

function fakeAudio(source: string): FakeAudio {
  return {
    source,
    currentTime: 12,
    preload: "none",
    loads: 0,
    plays: 0,
    load() {
      this.loads += 1;
    },
    async play() {
      this.plays += 1;
    },
  };
}

describe("notification sound player", () => {
  it("preloads and selects each bundled semantic cue", () => {
    const audio: FakeAudio[] = [];
    const player = createNotificationSoundPlayer({
      audioFactory(source) {
        const created = fakeAudio(source);
        audio.push(created);
        return created;
      },
      cooldownMs: 0,
    });

    player.preload();
    player.play("attention");
    player.play("complete");
    player.play("error");

    assert.deepEqual(
      audio.map((item) => item.source),
      [
        "/sounds/notification-attention.wav",
        "/sounds/notification-complete.wav",
        "/sounds/notification-error.wav",
      ],
    );
    assert.deepEqual(
      audio.map((item) => item.preload),
      ["auto", "auto", "auto"],
    );
    assert.deepEqual(
      audio.map((item) => item.loads),
      [1, 1, 1],
    );
    assert.deepEqual(
      audio.map((item) => item.plays),
      [1, 1, 1],
    );
    assert.deepEqual(
      audio.map((item) => item.currentTime),
      [0, 0, 0],
    );
  });

  it("coalesces tightly grouped cues with a global cooldown", () => {
    let now = 1_000;
    const audio: FakeAudio[] = [];
    const player = createNotificationSoundPlayer({
      audioFactory(source) {
        const created = fakeAudio(source);
        audio.push(created);
        return created;
      },
      now: () => now,
      cooldownMs: 750,
    });

    player.play("attention");
    now += 200;
    player.play("error");
    now += 550;
    player.play("complete");

    assert.equal(
      audio.find((item) => item.source.includes("attention"))?.plays,
      1,
    );
    assert.equal(
      audio.some((item) => item.source.includes("error")),
      false,
    );
    assert.equal(
      audio.find((item) => item.source.includes("complete"))?.plays,
      1,
    );
  });

  it("does nothing when audio is unavailable and absorbs play failures", async () => {
    const unavailable = createNotificationSoundPlayer({
      audioFactory: () => undefined,
    });
    assert.doesNotThrow(() => unavailable.play("attention"));

    const rejected = fakeAudio("/sounds/notification-error.wav");
    rejected.play = () => Promise.reject(new Error("autoplay blocked"));
    const player = createNotificationSoundPlayer({
      audioFactory: () => rejected,
    });
    assert.doesNotThrow(() => player.play("error"));
    await Promise.resolve();
  });
});
