import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TranscriptEntryMotionLedger } from "./transcript-entry-motion";

const live = (key: string) => ({ key, eligible: true });
const stored = (key: string) => ({ key, eligible: false });

describe("TranscriptEntryMotionLedger", () => {
  it("seeds the first projection without animating history", () => {
    const ledger = new TranscriptEntryMotionLedger();
    assert.equal(
      ledger.project("conversation-a", [stored("entry-1"), live("live-1")])
        .size,
      0,
    );
  });

  it("issues tokens only for later-added eligible live rows", () => {
    const ledger = new TranscriptEntryMotionLedger();
    ledger.project("conversation-a", [stored("entry-1")]);
    const tokens = ledger.project("conversation-a", [
      stored("entry-1"),
      stored("entry-2"),
      live("live-1"),
    ]);
    assert.equal(tokens.has("entry-2"), false);
    assert.ok(tokens.get("live-1"));
  });

  it("does not replay after temporary omission and reappearance", () => {
    const ledger = new TranscriptEntryMotionLedger();
    ledger.project("conversation-a", []);
    const token = ledger
      .project("conversation-a", [live("live-1")])
      .get("live-1");
    assert.ok(token);
    assert.equal(ledger.claim("live-1", token), true);
    ledger.project("conversation-a", []);
    assert.equal(
      ledger.project("conversation-a", [live("live-1")]).has("live-1"),
      false,
    );
  });

  it("expires an unclaimed token if replay temporarily omits the row", () => {
    const ledger = new TranscriptEntryMotionLedger();
    ledger.project("conversation-a", []);
    assert.equal(
      ledger.project("conversation-a", [live("live-1")]).has("live-1"),
      true,
    );
    ledger.project("conversation-a", []);
    assert.equal(
      ledger.project("conversation-a", [live("live-1")]).has("live-1"),
      false,
    );
  });

  it("allows each token to be consumed only once", () => {
    const ledger = new TranscriptEntryMotionLedger();
    ledger.project("conversation-a", []);
    const token = ledger
      .project("conversation-a", [live("live-1")])
      .get("live-1");
    assert.ok(token);
    assert.equal(ledger.claim("live-1", token), true);
    assert.equal(ledger.claim("live-1", token), false);
  });

  it("resets and seeds when conversation scope changes", () => {
    const ledger = new TranscriptEntryMotionLedger();
    ledger.project("conversation-a", []);
    assert.equal(
      ledger.project("conversation-a", [live("live-1")]).has("live-1"),
      true,
    );
    assert.equal(
      ledger.project("conversation-b", [live("live-1"), live("live-2")]).size,
      0,
    );
    assert.equal(
      ledger
        .project("conversation-b", [
          live("live-1"),
          live("live-2"),
          live("live-3"),
        ])
        .has("live-3"),
      true,
    );
  });
});
