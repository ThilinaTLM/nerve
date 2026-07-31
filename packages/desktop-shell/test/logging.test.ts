import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applicationLoggingEnabled } from "../src/logging.js";

describe("desktop application logging gate", () => {
  it("requires an exact explicit opt-in", () => {
    assert.equal(applicationLoggingEnabled({}), false);
    assert.equal(
      applicationLoggingEnabled({ NERVE_LOGGING_ENABLED: "true" }),
      false,
    );
    assert.equal(
      applicationLoggingEnabled({ NERVE_LOGGING_ENABLED: "0" }),
      false,
    );
    assert.equal(
      applicationLoggingEnabled({ NERVE_LOGGING_ENABLED: "1" }),
      true,
    );
  });
});
