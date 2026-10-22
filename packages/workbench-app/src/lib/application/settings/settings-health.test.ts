import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSettingsHealth,
  resolveSettingsHealth,
  settingsHealthSignature,
  settingsHealthToastTitle,
  updateSettingsHealthNotice,
} from "./settings-health";

const health = {
  invalid: [
    { id: "ui" as const, path: "/home/config/ui.json", reason: "Invalid JSON" },
  ],
};

test("settings health API loads problems and sends explicit resolution actions", async () => {
  const calls: { url: unknown; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url, init });
    return Response.json(health);
  }) as typeof fetch;
  try {
    assert.deepEqual(await fetchSettingsHealth(), health);
    assert.deepEqual(
      await resolveSettingsHealth({ id: "ui", action: "reload" }),
      health,
    );
    await resolveSettingsHealth({ id: "ui", action: "reset" });
    assert.equal(calls[0].url, "/api/settings/health");
    assert.equal(calls[1].url, "/api/settings/health/resolve");
    assert.equal(calls[1].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      id: "ui",
      action: "reload",
    });
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
      id: "ui",
      action: "reset",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("notice keeps problems on failure, shows server errors, and clears only after a successful repair", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json(
      { error: { message: "Cannot reset settings" } },
      { status: 409 },
    )) as typeof fetch;
  try {
    const failed = await updateSettingsHealthNotice(
      { health, pending: true },
      () => resolveSettingsHealth({ id: "ui", action: "reset" }),
    );
    assert.deepEqual(failed.health, health);
    assert.equal(failed.pending, false);
    assert.equal(failed.error, "Cannot reset settings");
    const repaired = await updateSettingsHealthNotice(failed, async () => ({
      invalid: [],
    }));
    assert.deepEqual(repaired, { health: { invalid: [] }, pending: false });
  } finally {
    globalThis.fetch = original;
  }
});

test("toasts only when the set of failing files changes", () => {
  const one = health;
  const two = {
    invalid: [
      ...health.invalid,
      {
        id: "harness" as const,
        path: "/home/config/harness.json",
        reason: "x",
      },
    ],
  };
  const reordered = { invalid: [...two.invalid].reverse() };
  assert.equal(
    settingsHealthSignature(two),
    settingsHealthSignature(reordered),
  );
  assert.notEqual(settingsHealthSignature(one), settingsHealthSignature(two));
  assert.equal(settingsHealthSignature({ invalid: [] }), "");
  assert.equal(
    settingsHealthToastTitle(one),
    "Settings need attention · 1 file",
  );
  assert.equal(
    settingsHealthToastTitle(two),
    "Settings need attention · 2 files",
  );
});
