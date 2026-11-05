import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createHostAllowlist } from "../../../src/adapters/http/host-allowlist.js";
import { tokensEqual } from "../../../src/adapters/http/token-compare.js";
import { sessionCookie } from "../../../src/domains/access/access-cookies.js";
import { withPeer } from "../../support/peer-address.js";
import { createApp } from "../../../src/app/server.js";
import { serveStatic } from "../../../src/adapters/http/static-files.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

const roots: string[] = [];
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("host allowlist", () => {
  const none = { addresses: () => [], env: {} };

  it("allows loopback names with any port and rejects DNS names", () => {
    const allowed = createHostAllowlist({ host: "127.0.0.1" }, none);
    for (const host of [
      "localhost",
      "localhost:3747",
      "127.0.0.1:1",
      "[::1]:80",
    ])
      assert.equal(allowed(host), true, host);
    for (const host of [
      "evil.example",
      "127.0.0.1.evil.example",
      "127.evil.example",
      "0.0.0.0",
      "",
      undefined,
    ])
      assert.equal(allowed(host), false, String(host));
  });

  it("derives LAN hosts from the bound address, interfaces and mobile hosts", () => {
    const wildcard = createHostAllowlist(
      { host: "0.0.0.0", mobileHttps: { hosts: ["10.0.0.9"] } },
      { addresses: () => ["192.168.1.5"], env: {} },
    );
    assert.equal(wildcard("192.168.1.5:3747"), true);
    assert.equal(wildcard("10.0.0.9"), true);
    assert.equal(wildcard("192.168.1.6"), false);
    assert.equal(
      createHostAllowlist({ host: "192.168.1.7" }, none)("192.168.1.7"),
      true,
    );
    assert.equal(
      createHostAllowlist(
        { host: "0.0.0.0" },
        { ...none, env: { NERVE_ALLOWED_HOSTS: "box.lan, Other.Net" } },
      )("other.net:1"),
      true,
    );
  });
});

describe("token hygiene", () => {
  it("compares tokens by value", () => {
    assert.equal(tokensEqual("nt_a", "nt_a"), true);
    assert.equal(tokensEqual("nt_a", "nt_b"), false);
    assert.equal(tokensEqual("nt_a", "nt_aa"), false);
    assert.equal(tokensEqual(undefined, "nt_a"), false);
  });

  it("issues device cookies that expire with the device, Secure and __Host- over HTTPS", () => {
    const expiresAt = Date.UTC(2030, 0, 1);
    const plain = sessionCookie({
      credential: "nd_x",
      expiresAt,
      secure: false,
    });
    assert.match(plain, /^nerve_session=/);
    assert.match(plain, /Expires=Tue, 01 Jan 2030/);
    assert.doesNotMatch(plain, /Secure/);
    const secure = sessionCookie({
      credential: "nd_x",
      expiresAt,
      secure: true,
    });
    assert.match(secure, /^__Host-nerve_session=/);
    assert.match(secure, /; Secure/);
  });
});

describe("server host guard and static cookie", () => {
  async function app() {
    const home = await mkdtemp(join(tmpdir(), "nerve-host-guard-"));
    roots.push(home);
    const web = join(home, "web-dist");
    await mkdir(web);
    await writeFile(join(web, "index.html"), "index");
    process.env.NERVE_WEB_DIST = web;
    const storage = await initializeStorage(join(home, "home"));
    const { runtime } = createRuntimeFixture(storage, "127.0.0.1", 0);
    return { app: withPeer(createApp(runtime)), token: storage.localToken };
  }

  it("rejects a rebinding Host on API, static and health with valid credentials", async () => {
    const { app: server, token } = await app();
    const headers = { host: "evil.example", cookie: `nerve_token=${token}` };
    for (const path of ["/api/client-config", "/", "/health"]) {
      const response = await server.request(path, { headers });
      assert.equal(response.status, 421, path);
    }
    const ok = await server.request("/api/client-config", {
      headers: { host: "127.0.0.1:43967", cookie: `nerve_token=${token}` },
    });
    assert.equal(ok.status, 200);
  });

  it("does not issue the auth cookie from static responses", async () => {
    const { app: server } = await app();
    const response = await server.request("/", {
      headers: { host: "127.0.0.1:43967" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const direct = await serveStatic("/", { host: "127.0.0.1", port: 1 });
    assert.equal(direct.headers.get("set-cookie"), null);
  });

  it("exchanges ?token= once for a revocable legacy-token device via a clean redirect", async () => {
    const { app: server, token } = await app();
    const response = await server.request(`/?token=${token}&x=1`, {
      headers: { host: "127.0.0.1:43967" },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/?x=1");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^nerve_session=nd_dev_/);
    const devices = await server.request("/api/access/devices", {
      headers: { host: "127.0.0.1:43967", cookie: cookie.split(";")[0]! },
    });
    const listed = (await devices.json()) as {
      devices: Array<{ name: string; method: string; current: boolean }>;
    };
    assert.deepEqual(
      listed.devices.map((d) => [d.name, d.method, d.current]),
      [["Legacy link", "legacy-token", true]],
    );
    const bad = await server.request("/?token=nope");
    assert.equal(bad.status, 200);
  });

  it("refuses to redeem a legacy link over plaintext from a LAN peer", async () => {
    const { app: server, token } = await app();
    const lan = withPeer(server, "192.168.1.20");
    const response = await lan.request(`/?token=${token}`, {
      headers: { host: "127.0.0.1:43967" },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(await response.text(), /HTTPS pairing/);
  });
});
