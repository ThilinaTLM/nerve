import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  DEVICE_ABSOLUTE_LIFETIME_MS,
  DEVICE_IDLE_LIFETIME_MS,
} from "@nervekit/contracts/access";
import { DeviceStore } from "../../../src/domains/access/device-store.js";

const DAY = 24 * 60 * 60_000;
const roots: string[] = [];
after(() =>
  Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))),
);

async function fixture(start = 1_000_000) {
  const dir = await mkdtemp(join(tmpdir(), "nerve-device-store-"));
  roots.push(dir);
  const path = join(dir, "secrets", "devices.json");
  const clock = { now: start };
  const open = () => new DeviceStore(path, { now: () => clock.now });
  return { path, clock, store: open(), open };
}

describe("DeviceStore", () => {
  it("stores only a hash of the secret in a 0600 file and authenticates the credential", async () => {
    const { path, store } = await fixture();
    const { device, credential } = await store.create({
      name: "Pixel",
      kind: "mobile",
      method: "pairing",
    });
    const secret = credential.split(".")[1]!;
    const text = await readFile(path, "utf8");
    assert.ok(!text.includes(secret));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const result = await store.authenticate(credential);
    assert.equal(result.ok && result.device.id, device.id);
    assert.deepEqual(await store.authenticate(`${credential}x`), {
      ok: false,
      reason: "unknown",
    });
    assert.deepEqual(await store.authenticate("nd_nope"), {
      ok: false,
      reason: "malformed",
    });
  });

  it("persists devices across reloads", async () => {
    const { store, open } = await fixture();
    const { credential } = await store.create({
      name: "Laptop",
      kind: "browser",
      method: "passkey",
    });
    const result = await open().authenticate(credential);
    assert.equal(result.ok, true);
  });

  it("ends a device 180 days after pairing regardless of activity", async () => {
    const { store, clock } = await fixture();
    const { credential, device } = await store.create({
      name: "d",
      kind: "cli",
      method: "pairing",
    });
    assert.equal(
      device.expiresAt - device.createdAt,
      DEVICE_ABSOLUTE_LIFETIME_MS,
    );
    let current = credential;
    // Active every 20 days: idle never triggers, absolute cap still does.
    for (let day = 20; day < 180; day += 20) {
      clock.now += 20 * DAY;
      const result = await store.authenticate(current);
      assert.ok(result.ok, `day ${day}`);
      if (result.ok && result.rotated) current = result.rotated;
    }
    clock.now = device.createdAt + DEVICE_ABSOLUTE_LIFETIME_MS;
    assert.deepEqual(await store.authenticate(current), {
      ok: false,
      reason: "expired",
    });
    const [listed] = await store.list();
    assert.equal(listed?.status, "expired");
  });

  it("ends a device after 30 idle days", async () => {
    const { store, clock } = await fixture();
    const { credential } = await store.create({
      name: "d",
      kind: "cli",
      method: "pairing",
    });
    clock.now += DEVICE_IDLE_LIFETIME_MS - 1;
    const last = await store.authenticate(credential);
    assert.ok(last.ok);
    const current = last.rotated ?? credential;
    clock.now += DEVICE_IDLE_LIFETIME_MS;
    assert.deepEqual(await store.authenticate(current), {
      ok: false,
      reason: "idle",
    });
  });

  it("rotates a secret older than 24 h and keeps the previous one valid for 60 s", async () => {
    const { store, clock } = await fixture();
    const { credential } = await store.create({
      name: "d",
      kind: "browser",
      method: "pairing",
    });
    clock.now += DAY - 1000;
    const early = await store.authenticate(credential);
    assert.ok(early.ok && early.rotated === undefined);
    clock.now += 2000;
    const rotation = await store.authenticate(credential);
    assert.ok(
      rotation.ok && rotation.rotated && rotation.rotated !== credential,
    );
    const next = rotation.ok ? rotation.rotated! : "";
    clock.now += 30_000;
    assert.equal(
      (await store.authenticate(credential)).ok,
      true,
      "grace period",
    );
    assert.equal((await store.authenticate(next)).ok, true);
    clock.now += 31_000;
    assert.deepEqual(await store.authenticate(credential), {
      ok: false,
      reason: "unknown",
    });
    assert.equal((await store.authenticate(next)).ok, true);
  });

  it("revokes one device or all but one", async () => {
    const { store } = await fixture();
    const a = await store.create({
      name: "a",
      kind: "browser",
      method: "pairing",
    });
    const b = await store.create({
      name: "b",
      kind: "browser",
      method: "pairing",
    });
    const c = await store.create({
      name: "c",
      kind: "browser",
      method: "pairing",
    });
    assert.ok(await store.revoke(a.device.id));
    assert.equal((await store.authenticate(a.credential)).ok, false);
    const removed = await store.revokeAll({ exceptDeviceId: b.device.id });
    assert.deepEqual(
      removed.map((d) => d.id),
      [c.device.id],
    );
    assert.equal((await store.authenticate(b.credential)).ok, true);
    assert.equal(await store.activeCount(), 1);
  });

  it("keeps passkeys beside devices and clears them on reset", async () => {
    const { store, open } = await fixture();
    await store.addPasskey({
      id: "pk1",
      publicKey: "k",
      counter: 0,
      name: "Key",
      createdAt: 1,
    });
    assert.equal((await open().passkeys()).length, 1);
    assert.equal(await store.clearPasskeys(), 1);
    assert.equal((await open().passkeys()).length, 0);
  });

  it("treats a damaged file as empty rather than failing", async () => {
    const { store, path } = await fixture();
    await store.create({ name: "d", kind: "browser", method: "pairing" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{broken");
    assert.deepEqual(await new DeviceStore(path).list(), []);
  });
});
