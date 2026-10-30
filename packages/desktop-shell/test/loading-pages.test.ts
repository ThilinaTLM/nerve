import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HomeAdmissionError } from "@nervekit/contracts/settings";
import {
  errorHtml,
  loadingHtml,
  startupErrorRetryable,
} from "../src/window/loading-pages.js";

describe("loadingHtml", () => {
  it("renders the shared splash hooks and escapes the status text", () => {
    const html = loadingHtml({ status: `Waiting for "local" <daemon>` });
    assert.match(html, /id="startup-splash"/);
    assert.match(html, /id="startup-splash-status"/);
    assert.match(html, /id="startup-splash-fill"/);
    assert.match(html, /Waiting for &quot;local&quot; &lt;daemon&gt;/);
    assert.doesNotMatch(html, /<daemon>/);
  });
});

describe("errorHtml", () => {
  it("renders concise retry guidance with escaped collapsed diagnostics", () => {
    const html = errorHtml(
      new Error(`failed <script>alert("x")</script>`),
      "/tmp/<nerve>",
      { retry: true },
    );
    assert.match(html, /Nerve is unavailable/);
    assert.match(html, /Try again/);
    assert.match(html, /Technical details/);
    assert.match(html, /retryStartup/);
    assert.match(html, /failed &lt;script&gt;/);
    assert.match(html, /\/tmp\/&lt;nerve&gt;\/logs/);
    assert.doesNotMatch(html, /failed <script>/);
    assert.doesNotMatch(html, /Restart Daemon/);
  });

  it("omits retry scripting when retry is unavailable", () => {
    const html = errorHtml(new Error("offline"));
    assert.doesNotMatch(html, /startup-retry/);
    assert.doesNotMatch(html, /script-src/);
  });

  it("renders only safe structured migration failure details", () => {
    const html = errorHtml({
      failure: {
        code: "MIGRATION_STEP_FAILED",
        phase: "apply",
        message: "Storage migration failed.",
        retryable: false,
        stepId: "0010-example",
        cause: "token=secret",
        path: "/private/data/record.json",
      },
    });
    assert.match(html, /MIGRATION_STEP_FAILED/);
    assert.match(html, /0010-example/);
    assert.doesNotMatch(html, /token=secret/);
    assert.doesNotMatch(html, /private\/data/);
    assert.doesNotMatch(html, /startup-retry/);
  });

  it("offers retry for retryable structured migration failures", () => {
    const html = errorHtml({
      failure: {
        code: "MIGRATION_HOME_LOCKED",
        phase: "lock",
        message: "Storage is temporarily locked.",
        retryable: true,
      },
    });
    assert.match(html, /startup-retry/);
  });
});

void it("offers archive recovery without retry for typed admission errors across child-process boundaries", () => {
  for (const kind of [
    "too_old",
    "manifest_invalid",
    "ledger_unexpected",
    "layout_unrecognized",
  ] as const) {
    const error = new Error(
      new HomeAdmissionError(kind, "preserve <data>").message,
    );
    const html = errorHtml(error, "/tmp/home", { retry: true });
    assert.equal(startupErrorRetryable(error), false);
    assert.match(html, /Start fresh, keep providers/);
    assert.match(html, /Open data folder/);
    assert.match(html, /Copy diagnostics/);
    assert.doesNotMatch(html, /id="startup-retry"/);
    assert.equal(html.includes("Upgrade through 0.34.1"), kind === "too_old");
    assert.match(html, /preserve &lt;data&gt;/);
  }
  assert.equal(startupErrorRetryable(new Error("unknown failure")), false);
});
