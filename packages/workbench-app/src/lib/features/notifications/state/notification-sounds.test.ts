import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNotificationSoundPlayer } from "./notification-sounds";

type FakeAudio = {
  source: string;
  currentTime: number;
  muted: boolean;
  preload: string;
  loads: number;
  pauses: number;
  plays: number;
  rejectPlay: boolean;
  load: () => void;
  pause: () => void;
  play: () => Promise<void>;
};

function fakeAudio(source: string): FakeAudio {
  return {
    source,
    currentTime: 12,
    muted: false,
    preload: "none",
    loads: 0,
    pauses: 0,
    plays: 0,
    rejectPlay: false,
    load() {
      this.loads += 1;
    },
    pause() {
      this.pauses += 1;
    },
    async play() {
      this.plays += 1;
      if (this.rejectPlay) throw new Error("autoplay blocked");
    },
  };
}

describe("notification sound player", () => {
  it("preloads the complete bundled tone catalog", () => {
    const audio: FakeAudio[] = [];
    const player = createNotificationSoundPlayer({
      audioFactory(source) {
        const created = fakeAudio(source);
        audio.push(created);
        return created;
      },
    });

    player.preload();

    assert.deepEqual(
      audio.map((item) => item.source),
      [
        "/sounds/bell.mp3",
        "/sounds/chime.mp3",
        "/sounds/click.mp3",
        "/sounds/pop.mp3",
        "/sounds/success.mp3",
        "/sounds/alert.mp3",
        "/sounds/kenney-click-1.mp3",
        "/sounds/kenney-click-2.mp3",
        "/sounds/kenney-click-3.mp3",
        "/sounds/kenney-rollover-1.mp3",
        "/sounds/kenney-rollover-4.mp3",
        "/sounds/kenney-rollover-6.mp3",
        "/sounds/kenney-switch-1.mp3",
        "/sounds/kenney-switch-7.mp3",
        "/sounds/kenney-switch-10.mp3",
        "/sounds/kenney-switch-15.mp3",
        "/sounds/kenney-switch-20.mp3",
        "/sounds/kenney-switch-31.mp3",
      ],
    );
    assert.deepEqual(
      audio.map((item) => item.preload),
      new Array(18).fill("auto"),
    );
    assert.deepEqual(
      audio.map((item) => item.loads),
      new Array(18).fill(1),
    );
  });

  it("unlocks every reusable element muted and resets it", async () => {
    const audio: FakeAudio[] = [];
    const player = createNotificationSoundPlayer({
      audioFactory(source) {
        const created = fakeAudio(source);
        audio.push(created);
        return created;
      },
    });

    player.unlock();
    assert.equal(
      audio.every((item) => item.muted),
      true,
    );
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      audio.every((item) => item.plays === 1),
      true,
    );
    assert.equal(
      audio.every((item) => item.pauses === 1),
      true,
    );
    assert.equal(
      audio.every((item) => item.currentTime === 0),
      true,
    );
    assert.equal(
      audio.every((item) => !item.muted),
      true,
    );
  });

  it("does not let a pending unlock silence an explicit preview", async () => {
    let resolveUnlock!: () => void;
    const unlockFinished = new Promise<void>((resolve) => {
      resolveUnlock = resolve;
    });
    const bell = fakeAudio("/sounds/bell.mp3");
    bell.play = async () => {
      bell.plays += 1;
      if (bell.plays === 1) await unlockFinished;
    };
    const player = createNotificationSoundPlayer({
      audioFactory: (source) =>
        source.endsWith("bell.mp3") ? bell : fakeAudio(source),
    });

    player.unlock();
    player.preview("bell");
    resolveUnlock();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(bell.plays, 2);
    assert.equal(bell.pauses, 0);
    assert.equal(bell.muted, false);
  });

  it("coalesces runtime cues while previews bypass the cooldown", () => {
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

    player.play("bell");
    now += 200;
    player.play("alert");
    player.preview("pop");
    player.preview("pop");
    now += 550;
    player.play("success");

    assert.equal(audio.find((item) => item.source.includes("bell"))?.plays, 1);
    assert.equal(
      audio.some((item) => item.source.includes("alert")),
      false,
    );
    assert.equal(audio.find((item) => item.source.includes("pop"))?.plays, 2);
    assert.equal(
      audio.find((item) => item.source.includes("success"))?.plays,
      1,
    );
  });

  it("does not let a rejected play consume the cooldown", async () => {
    const rejected = fakeAudio("/sounds/bell.mp3");
    rejected.rejectPlay = true;
    const player = createNotificationSoundPlayer({
      audioFactory: () => rejected,
    });

    player.play("bell");
    await Promise.resolve();
    await Promise.resolve();
    rejected.rejectPlay = false;
    player.play("bell");

    assert.equal(rejected.plays, 2);
  });

  it("does nothing when audio is unavailable", () => {
    const player = createNotificationSoundPlayer({
      audioFactory: () => undefined,
    });
    assert.doesNotThrow(() => player.play("bell"));
    assert.doesNotThrow(() => player.preview("alert"));
    assert.doesNotThrow(() => player.unlock());
  });
});
