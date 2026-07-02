import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOAuthLoginFailure } from "../src/domains/auth/oauth-flow-manager.js";

describe("OAuth login failure formatting", () => {
  it("adds certificate guidance for corporate TLS interception failures", () => {
    const formatted = formatOAuthLoginFailure(
      "anthropic",
      "Token exchange request failed. details=TypeError: fetch failed; cause=Error: self signed certificate in certificate chain; code=SELF_SIGNED_CERT_IN_CHAIN",
    );

    assert.match(formatted, /TLS certificate trust failure/);
    assert.match(formatted, /NODE_EXTRA_CA_CERTS/);
    assert.match(formatted, /fresh login/);
  });

  it("adds proxy guidance for network failures", () => {
    const formatted = formatOAuthLoginFailure(
      "openai-codex",
      "OpenAI Codex token exchange failed: fetch failed; cause=Error: connect ETIMEDOUT",
    );

    assert.match(formatted, /network or proxy failure/);
    assert.match(formatted, /HTTPS_PROXY\/HTTP_PROXY/);
    assert.match(formatted, /device-code login/);
  });

  it("leaves unrelated failures unchanged", () => {
    const message = "OAuth state mismatch";
    assert.equal(formatOAuthLoginFailure("anthropic", message), message);
  });
});
