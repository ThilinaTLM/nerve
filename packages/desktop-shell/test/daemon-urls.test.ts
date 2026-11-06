import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRemoteDaemonUrl } from "../src/daemon/urls.ts";

describe("daemon url policy", () => {
  it("normalizes remote urls to origins and rejects non-http protocols", () => {
    assert.equal(
      normalizeRemoteDaemonUrl("https://nerve.example.com:8443/some/path"),
      "https://nerve.example.com:8443",
    );
    assert.equal(
      normalizeRemoteDaemonUrl("http://10.0.0.5:3747"),
      "http://10.0.0.5:3747",
    );
    assert.throws(
      () => normalizeRemoteDaemonUrl("ws://example.com"),
      /http:\/\/ or https:\/\//,
    );
  });
});
