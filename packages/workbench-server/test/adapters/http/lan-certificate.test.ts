import assert from "node:assert/strict";
import { makeTempDir } from "@nervekit/test-kit";
import { X509Certificate } from "node:crypto";
import { describe, it } from "node:test";
import { ensureMobileHttpsTlsMaterial } from "../../../src/infrastructure/tls/lan-certificate.js";

describe("mobile HTTPS LAN certificate material", () => {
  it("creates a reusable local CA and a server certificate with LAN SANs", async (t) => {
    const home = await makeTempDir(t, "nerve-lan-cert-");
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

  it("reuses the leaf server certificate across restarts with the same hosts", async (t) => {
    const home = await makeTempDir(t, "nerve-lan-cert-");
    const first = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);
    const second = await ensureMobileHttpsTlsMaterial(home, ["192.168.1.42"]);

    assert.equal(first.certPem, second.certPem);
    assert.equal(first.keyPem, second.keyPem);
    assert.equal(first.caCertPem, second.caCertPem);
  });

  it("rotates the leaf certificate when hosts change but keeps the CA stable", async (t) => {
    const home = await makeTempDir(t, "nerve-lan-cert-");
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
