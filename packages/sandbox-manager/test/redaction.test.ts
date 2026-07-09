import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactManagerEvent } from "../src/events/redaction.js";

describe("manager event redaction", () => {
  it("preserves structured metadata fields while redacting scalar secret values", () => {
    const redacted = redactManagerEvent({
      secretStores: [{ id: "manager", status: "available" }],
      token: "ntok_secret",
      nested: { apiKey: { file: "/secrets/controller-token" } },
    });

    assert.deepEqual(redacted.secretStores, [
      { id: "manager", status: "available" },
    ]);
    assert.equal(redacted.token, "[REDACTED]");
    assert.deepEqual(redacted.nested.apiKey, {
      file: "/secrets/controller-token",
    });
  });
});
