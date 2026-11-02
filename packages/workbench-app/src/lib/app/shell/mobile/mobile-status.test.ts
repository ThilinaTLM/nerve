import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionLabel,
  mobileConnectionState,
  mobileStatusBanner,
  usageAttention,
} from "./mobile-status.js";

const calm = [
  {
    provider: "anthropic",
    usage: { session: { usedPercent: 20 }, weekly: { usedPercent: 40 } },
  },
];

test("connection state follows the channels first", () => {
  assert.equal(
    mobileConnectionState({ channelsConnected: true, connection: "closed" }),
    "connected",
  );
  assert.equal(
    mobileConnectionState({
      channelsConnected: false,
      connection: "connected",
    }),
    "reconnecting",
  );
  assert.equal(
    mobileConnectionState({ channelsConnected: false, connection: "error" }),
    "offline",
  );
  assert.equal(
    mobileConnectionState({
      channelsConnected: false,
      connection: "connecting",
    }),
    "connecting",
  );
  assert.equal(connectionLabel("offline"), "offline");
});

test("no banner while connected and quota is comfortable", () => {
  assert.equal(
    mobileStatusBanner({ state: "connected", usages: calm }),
    undefined,
  );
  assert.equal(
    mobileStatusBanner({ state: "connecting", usages: calm }),
    undefined,
  );
});

test("banner when disconnected or reconnecting", () => {
  assert.equal(
    mobileStatusBanner({ state: "offline", usages: calm })?.tone,
    "destructive",
  );
  assert.equal(
    mobileStatusBanner({ state: "reconnecting", usages: calm })?.tone,
    "warning",
  );
});

test("banner names the provider closest to its limit", () => {
  const usages = [
    ...calm,
    {
      provider: "openai-codex",
      usage: { session: { usedPercent: 93.4 }, weekly: { usedPercent: 96 } },
    },
  ];
  assert.deepEqual(usageAttention(usages), {
    provider: "openai-codex",
    percent: 96,
  });
  assert.equal(
    mobileStatusBanner({ state: "connected", usages })?.message,
    "Codex usage at 96%",
  );
});
