import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ensureMobileHttpsTlsMaterial } from "../src/infrastructure/tls/lan-certificate.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-lan-cert-"));
  roots.push(root);
  return root;
}

describe("mobile HTTPS LAN certificate material", () => {
  it("creates a reusable local CA and a server certificate with LAN SANs", async () => {
    const home = await tempHome();
    const first = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);
    const second = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);

    assert.equal(first.primaryHost, "192.168.1.42");
    assert.equal(first.caCertPem, second.caCertPem);
    assert.match(first.keyPem, /BEGIN PRIVATE KEY/);
    assert.match(first.certPem, /BEGIN CERTIFICATE/);

    const cert = new X509Certificate(first.certPem);
    assert.match(cert.subjectAltName ?? "", /IP Address:192\.168\.1\.42/);
    assert.match(cert.subjectAltName ?? "", /DNS:localhost/);
    assert.match(cert.subjectAltName ?? "", /IP Address:127\.0\.0\.1/);
  });

  it("reuses the leaf server certificate across restarts with the same hosts", async () => {
    const home = await tempHome();
    const first = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);
    const second = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);

    assert.equal(first.certPem, second.certPem);
    assert.equal(first.keyPem, second.keyPem);
    assert.equal(first.caCertPem, second.caCertPem);
  });

  it("rotates the leaf certificate when hosts change but keeps the CA stable", async () => {
    const home = await tempHome();
    const first = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);
    const second = await ensureMobileHttpsTlsMaterial(home, [
      "192.168.1.42",
      "192.168.1.99",
    ]);

    assert.notEqual(first.certPem, second.certPem);
    assert.equal(first.caCertPem, second.caCertPem);

    const cert = new X509Certificate(second.certPem);
    assert.match(cert.subjectAltName ?? "", /IP Address:192\.168\.1\.99/);
  });
});
