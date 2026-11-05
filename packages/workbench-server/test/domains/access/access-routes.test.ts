import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";
import { createApiAuthMiddleware } from "../../../src/adapters/http/auth-middleware.js";
import { createAccessRoutes } from "../../../src/adapters/http/routes/access-routes.js";
import {
  AccessService,
  type AccessSettings,
} from "../../../src/domains/access/access-service.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { withPeer } from "../../support/peer-address.js";

const roots: string[] = [];
after(() =>
  Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))),
);

const TOKEN = "nt_test-local-token";
const json = { "content-type": "application/json" };
const local = { authorization: `Bearer ${TOKEN}` };

async function fixture(settings: AccessSettings = {}) {
  const home = await mkdtemp(join(tmpdir(), "nerve-access-"));
  roots.push(home);
  const paths = storagePaths(home);
  const access = new AccessService({ paths, localToken: TOKEN, settings });
  const app = new Hono();
  app.use("/api/*", createApiAuthMiddleware(access.gate));
  app.route("/api/access", createAccessRoutes(access));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  const from = (address: string) => {
    const peerApp = withPeer(app, address);
    return peerApp;
  };
  return { access, paths, app, from };
}

/** A request over HTTPS from a LAN client, as through a TLS listener. */
const SECURE = "https://192.168.1.5:3748";

async function pairCode(app: Hono, purpose = "mobile") {
  const response = await withPeer(app).request("/api/access/pairing-codes", {
    method: "POST",
    headers: { ...local, ...json },
    body: JSON.stringify({ purpose }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { code: string; expiresAt: number };
}

describe("access routes", () => {
  it("pairs a phone over TLS with a cookie, lists it, and revokes it", async () => {
    const { app, access } = await fixture();
    const { code } = await pairCode(app);
    const peer = withPeer(app, "192.168.1.20");
    const redeem = await peer.request(`${SECURE}/api/access/pair`, {
      method: "POST",
      headers: { ...json, host: "192.168.1.5:3748" },
      body: JSON.stringify({ code, deviceName: "Pixel 8", kind: "mobile" }),
    });
    assert.equal(redeem.status, 200);
    const grant = (await redeem.json()) as {
      device: { id: string };
      credential?: string;
    };
    assert.equal(grant.credential, undefined, "browsers never see the secret");
    const setCookie = redeem.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^__Host-nerve_session=nd_dev_/);
    assert.match(setCookie, /HttpOnly; Secure|Secure; HttpOnly|; Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0]!;

    const ping = await peer.request(`${SECURE}/api/ping`, {
      headers: { cookie },
    });
    assert.equal(ping.status, 200);

    // The code was single use.
    const again = await peer.request(`${SECURE}/api/access/pair`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ code, deviceName: "Other", kind: "mobile" }),
    });
    assert.equal(again.status, 400);
    assert.equal(
      ((await again.json()) as { error: { code: string } }).error.code,
      "PAIRING_CODE_INVALID",
    );

    // The paired device can mint codes, list devices and sees itself as current.
    const devices = await peer.request(`${SECURE}/api/access/devices`, {
      headers: { cookie },
    });
    const listed = (await devices.json()) as {
      devices: Array<{ id: string; current: boolean; name: string }>;
    };
    assert.deepEqual(
      listed.devices.map((d) => [d.name, d.current]),
      [["Pixel 8", true]],
    );

    // Revocation closes live sockets and invalidates the credential.
    const closed: number[] = [];
    access.sockets.track(
      { kind: "device", deviceId: grant.device.id },
      { close: (c) => void closed.push(c ?? 0) },
    );
    const revoke = await withPeer(app).request(
      `/api/access/devices/${grant.device.id}`,
      { method: "DELETE", headers: local },
    );
    assert.equal(revoke.status, 200);
    assert.deepEqual(closed, [4401]);
    assert.equal(
      (await peer.request(`${SECURE}/api/ping`, { headers: { cookie } }))
        .status,
      401,
    );

    const events = (await access.audit.recent(10)).map((e) => e.type);
    assert.ok(events.includes("pair") && events.includes("revoked"));
    assert.ok(
      !JSON.stringify(await access.audit.recent(50)).includes("nd_dev_"),
    );
  });

  it("gives bearer clients the credential, rotates it, and refuses plaintext LAN auth", async () => {
    const { app, access } = await fixture();
    const { code } = await pairCode(app, "desktop");
    const lan = withPeer(app, "192.168.1.20");

    const plain = await lan.request("http://192.168.1.5:3747/api/access/pair", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        code,
        deviceName: "Remote desktop",
        kind: "desktop",
        delivery: "bearer",
      }),
    });
    assert.equal(plain.status, 403);
    assert.equal(
      ((await plain.json()) as { error: { code: string } }).error.code,
      "TLS_REQUIRED",
    );

    const redeem = await lan.request(`${SECURE}/api/access/pair`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        code,
        deviceName: "Remote desktop",
        kind: "desktop",
        delivery: "bearer",
      }),
    });
    const grant = (await redeem.json()) as {
      device: { id: string };
      credential: string;
    };
    assert.match(grant.credential, /^nd_dev_[0-9a-f]{16}\./);
    assert.equal(redeem.headers.get("set-cookie"), null);

    const bearer = { authorization: `Bearer ${grant.credential}` };
    assert.equal(
      (await lan.request(`${SECURE}/api/ping`, { headers: bearer })).status,
      200,
    );
    // Device credentials never travel over plaintext from the LAN.
    const plainUse = await lan.request("http://192.168.1.5:3747/api/ping", {
      headers: bearer,
    });
    assert.equal(plainUse.status, 403);
    assert.equal(
      ((await plainUse.json()) as { error: { code: string } }).error.code,
      "TLS_REQUIRED",
    );
    void access;
  });

  it("throttles wrong codes with Retry-After", async () => {
    const { app } = await fixture();
    const lan = withPeer(app, "203.0.113.9");
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) {
      last = await lan.request(`${SECURE}/api/access/pair`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          code: `WRONG${i}XX`,
          deviceName: "x",
          kind: "browser",
        }),
      });
    }
    assert.equal(last?.status, 429);
    assert.ok(Number(last?.headers.get("retry-after")) > 0);
    assert.equal(
      ((await last!.json()) as { error: { code: string } }).error.code,
      "RATE_LIMITED",
    );
  });

  it("restricts the local token to loopback and lets only the local owner rotate it", async () => {
    const { app, access } = await fixture();
    // Local bearer from the LAN is the deprecated remote path: accepted, flagged, never "local".
    const lan = withPeer(app, "192.168.1.20");
    const legacy = await lan.request(`${SECURE}/api/ping`, { headers: local });
    assert.equal(legacy.status, 200);
    assert.equal(access.legacyBearerSeen, true);
    const rotateRemote = await lan.request(
      `${SECURE}/api/access/local-token/rotate`,
      { method: "POST", headers: local },
    );
    assert.equal(rotateRemote.status, 403);
    // The cookie form is loopback-only.
    const cookie = await lan.request(`${SECURE}/api/ping`, {
      headers: { cookie: `nerve_token=${TOKEN}` },
    });
    assert.equal(cookie.status, 401);
    // Behind a forwarding proxy the local credential is refused outright.
    const proxied = await withPeer(app).request(
      "/api/access/local-token/rotate",
      {
        method: "POST",
        headers: { ...local, "x-forwarded-for": "1.2.3.4" },
      },
    );
    assert.equal(proxied.status, 403);

    const rotate = await withPeer(app).request(
      "/api/access/local-token/rotate",
      { method: "POST", headers: local },
    );
    assert.equal(rotate.status, 200);
    assert.notEqual(access.localToken, TOKEN);
    assert.equal(
      (await withPeer(app).request("/api/ping", { headers: local })).status,
      401,
    );
    assert.equal(
      (
        await withPeer(app).request("/api/ping", {
          headers: { authorization: `Bearer ${access.localToken}` },
        })
      ).status,
      200,
    );
  });

  it("revokes all devices except the caller", async () => {
    const { app } = await fixture();
    const peer = withPeer(app, "192.168.1.20");
    const creds: string[] = [];
    for (const name of ["a", "b", "c"]) {
      const { code } = await pairCode(app);
      const r = await peer.request(`${SECURE}/api/access/pair`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          code,
          deviceName: name,
          kind: "browser",
          delivery: "bearer",
        }),
      });
      creds.push(((await r.json()) as { credential: string }).credential);
    }
    const auth = (i: number) => ({ authorization: `Bearer ${creds[i]}` });
    const result = await peer.request(
      `${SECURE}/api/access/devices/revoke-all`,
      { method: "POST", headers: { ...auth(0), ...json }, body: "{}" },
    );
    assert.deepEqual(await result.json(), { revoked: 2 });
    assert.equal(
      (await peer.request(`${SECURE}/api/ping`, { headers: auth(0) })).status,
      200,
    );
    assert.equal(
      (await peer.request(`${SECURE}/api/ping`, { headers: auth(1) })).status,
      401,
    );
  });

  it("requires the Origin proof for cookie-authenticated writes and WebSockets-style requests", async () => {
    const { app } = await fixture();
    const peer = withPeer(app, "192.168.1.20");
    const { code } = await pairCode(app);
    const redeem = await peer.request(`${SECURE}/api/access/pair`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ code, deviceName: "b", kind: "browser" }),
    });
    const cookie = (redeem.headers.get("set-cookie") ?? "").split(";")[0]!;
    const noOrigin = await peer.request(`${SECURE}/api/access/pairing-codes`, {
      method: "POST",
      headers: { cookie, ...json },
      body: JSON.stringify({ purpose: "mobile" }),
    });
    assert.equal(noOrigin.status, 403);
    const sameOrigin = await peer.request(
      `${SECURE}/api/access/pairing-codes`,
      {
        method: "POST",
        headers: { cookie, ...json, origin: "https://192.168.1.5:3748" },
        body: JSON.stringify({ purpose: "mobile" }),
      },
    );
    assert.equal(sameOrigin.status, 200);
  });

  it("reports session state without a credential", async () => {
    const { app } = await fixture();
    const lan = withPeer(app, "192.168.1.20");
    const anonymous = await lan.request(
      "http://192.168.1.5:3747/api/access/session",
    );
    assert.equal(anonymous.status, 200);
    const session = (await anonymous.json()) as {
      authenticated: boolean;
      principal: string;
      pairingAvailable: boolean;
      pairingBlockedReason?: string;
    };
    assert.equal(session.authenticated, false);
    assert.equal(session.principal, "none");
    assert.equal(session.pairingAvailable, false);
    assert.equal(session.pairingBlockedReason, "plaintext_transport");
    const own = await withPeer(app).request("/api/access/session", {
      headers: local,
    });
    assert.equal(
      ((await own.json()) as { principal: string }).principal,
      "local",
    );
  });
});

describe("passkey gate with publicUrl", () => {
  const settings = {
    publicUrl: "https://nerve.example.com",
    trustProxyPeers: ["172.17.0.0/16"],
  };
  const proxied = (extra: Record<string, string> = {}) => ({
    host: "nerve.example.com",
    "x-forwarded-for": "203.0.113.7",
    "x-forwarded-proto": "https",
    ...extra,
  });

  it("accepts no remote request but enrollment until an owner passkey exists", async () => {
    const { app, access } = await fixture(settings);
    const proxy = withPeer(app, "172.17.0.2");
    const blocked = await proxy.request("https://nerve.example.com/api/ping", {
      headers: proxied(local),
    });
    assert.equal(blocked.status, 403);
    assert.equal(
      ((await blocked.json()) as { error: { code: string } }).error.code,
      "PASSKEY_ENROLLMENT_REQUIRED",
    );

    const session = await proxy.request(
      "https://nerve.example.com/api/access/session",
      { headers: proxied() },
    );
    const body = (await session.json()) as {
      passkey: {
        required: boolean;
        enrollmentOpen: boolean;
        loginAvailable: boolean;
      };
    };
    assert.deepEqual(body.passkey, {
      required: true,
      enrolled: false,
      loginAvailable: false,
      enrollmentOpen: true,
    });

    // Pairing codes for other devices cannot be minted yet, even by the local owner.
    const mint = await withPeer(app).request("/api/access/pairing-codes", {
      method: "POST",
      headers: { ...local, ...json },
      body: JSON.stringify({ purpose: "mobile" }),
    });
    assert.equal(mint.status, 409);

    // A setup code is checked on registration; a wrong one is refused.
    const wrong = await proxy.request(
      "https://nerve.example.com/api/access/passkeys/register/options",
      {
        method: "POST",
        headers: proxied(json),
        body: JSON.stringify({ setupCode: "NOPE-NOPE" }),
      },
    );
    assert.equal(wrong.status, 400);
    const setup = access.createSetupCode();
    assert.equal(setup.url, `https://nerve.example.com/#pair=${setup.code}`);
    const options = await proxy.request(
      "https://nerve.example.com/api/access/passkeys/register/options",
      {
        method: "POST",
        headers: proxied(json),
        body: JSON.stringify({ setupCode: setup.code }),
      },
    );
    assert.equal(options.status, 200);
    const { options: creation } = (await options.json()) as {
      options: { rp: { id: string }; challenge: string };
    };
    assert.equal(creation.rp.id, "nerve.example.com");
    // Setup codes are not pairing codes.
    const asPair = await proxy.request(
      "https://nerve.example.com/api/access/pair",
      {
        method: "POST",
        headers: proxied(json),
        body: JSON.stringify({
          code: setup.code,
          deviceName: "x",
          kind: "browser",
        }),
      },
    );
    assert.equal(asPair.status, 403);
    // Login has nothing to log in with yet.
    const login = await proxy.request(
      "https://nerve.example.com/api/access/login/options",
      { method: "POST", headers: proxied(json), body: "{}" },
    );
    assert.equal(login.status, 409);
  });

  it("keeps the local owner working on loopback while the gate is closed", async () => {
    const { app } = await fixture(settings);
    const own = await withPeer(app).request("/api/ping", {
      headers: { ...local, host: "127.0.0.1:43967" },
    });
    assert.equal(own.status, 200);
  });

  it("refuses passkey routes without a publicUrl", async () => {
    const { app } = await fixture();
    const response = await withPeer(app).request(
      "/api/access/passkeys/register/options",
      {
        method: "POST",
        headers: { ...local, ...json },
        body: "{}",
      },
    );
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "PUBLIC_URL_REQUIRED",
    );
  });
});
