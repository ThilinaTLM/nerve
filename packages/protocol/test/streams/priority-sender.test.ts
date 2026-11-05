import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NerveMessage } from "@nervekit/contracts/wire";
import { PrioritizedMessageSender } from "../../src/streams/priority-sender.js";

const msg = (id: string) => ({ id }) as unknown as NerveMessage;
const ids = (messages: NerveMessage[]) =>
  messages.map((m) => (m as unknown as { id: string }).id);

function gated() {
  const sent: NerveMessage[] = [];
  let release: () => void = () => {};
  let gate = new Promise<void>((resolve) => (release = resolve));
  const sender = new PrioritizedMessageSender(async (message) => {
    sent.push(message);
    await gate;
  });
  return {
    sender,
    sent,
    open: () => {
      release();
      gate = Promise.resolve();
    },
  };
}

describe("PrioritizedMessageSender", () => {
  it("sends control, then replay, then live while a write is in flight, FIFO within a class", async () => {
    const f = gated();
    const all = [
      f.sender.send(msg("live0"), "live"),
      f.sender.send(msg("live1"), "live"),
      f.sender.send(msg("replay1"), "replay"),
      f.sender.send(msg("control1"), "control"),
      f.sender.send(msg("replay2"), "replay"),
      f.sender.send(msg("control2"), "control"),
    ];
    f.open();
    await Promise.all(all);
    assert.deepEqual(ids(f.sent), [
      "live0",
      "control1",
      "control2",
      "replay1",
      "replay2",
      "live1",
    ]);
  });

  it("rejects only the failed send and keeps draining", async () => {
    const sent: string[] = [];
    const sender = new PrioritizedMessageSender((message) => {
      const id = (message as unknown as { id: string }).id;
      sent.push(id);
      if (id === "bad") throw new Error("write failed");
    });
    const bad = sender.send(msg("bad"), "live");
    const good = sender.send(msg("good"), "live");
    await assert.rejects(bad, /write failed/);
    await good;
    assert.deepEqual(sent, ["bad", "good"]);
  });

  it("close rejects queued sends but lets the in-flight one finish", async () => {
    const f = gated();
    const inFlight = f.sender.send(msg("a"), "live");
    const queued = f.sender.send(msg("b"), "control");
    f.sender.close(new Error("closed"));
    f.open();
    await inFlight;
    await assert.rejects(queued, /closed/);
    assert.deepEqual(ids(f.sent), ["a"]);
  });
});
