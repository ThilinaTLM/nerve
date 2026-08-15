import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDevelopmentPerformanceDiagnostics,
  createPerformanceSessionId,
} from "../src/performance/development-diagnostics.js";

const sessionOptions = {
  now: () => new Date("2026-08-15T10:20:30.456Z"),
  pid: 42,
};

describe("development performance diagnostics policy", () => {
  it("enables diagnostics for an unpackaged source launch", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDevelopmentPerformanceDiagnostics(false, env, sessionOptions);
    assert.equal(env.NERVE_PERFORMANCE_DIAGNOSTICS, "1");
    assert.equal(
      env.NERVE_PERFORMANCE_SESSION_ID,
      "20260815T102030456Z-desktop-42",
    );
  });

  it("does not affect packaged launches", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDevelopmentPerformanceDiagnostics(true, env, sessionOptions);
    assert.equal(env.NERVE_PERFORMANCE_DIAGNOSTICS, undefined);
  });

  it("preserves explicit developer overrides", () => {
    const disabled: NodeJS.ProcessEnv = {
      NERVE_PERFORMANCE_DIAGNOSTICS: "0",
    };
    const enabled: NodeJS.ProcessEnv = {
      NERVE_PERFORMANCE_DIAGNOSTICS: "1",
      NERVE_PERFORMANCE_SESSION_ID: "existing-session",
    };
    applyDevelopmentPerformanceDiagnostics(false, disabled, sessionOptions);
    applyDevelopmentPerformanceDiagnostics(false, enabled, sessionOptions);
    assert.equal(disabled.NERVE_PERFORMANCE_DIAGNOSTICS, "0");
    assert.equal(disabled.NERVE_PERFORMANCE_SESSION_ID, undefined);
    assert.equal(enabled.NERVE_PERFORMANCE_DIAGNOSTICS, "1");
    assert.equal(enabled.NERVE_PERFORMANCE_SESSION_ID, "existing-session");
  });

  it("creates safe IDs and supports explicit packaged diagnostics", () => {
    assert.equal(
      createPerformanceSessionId(new Date("2026-08-15T10:20:30.456Z"), 42),
      "20260815T102030456Z-desktop-42",
    );
    const env: NodeJS.ProcessEnv = { NERVE_PERFORMANCE_DIAGNOSTICS: "1" };
    applyDevelopmentPerformanceDiagnostics(true, env, sessionOptions);
    assert.equal(
      env.NERVE_PERFORMANCE_SESSION_ID,
      "20260815T102030456Z-desktop-42",
    );
  });
});
