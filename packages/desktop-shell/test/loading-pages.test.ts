import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  errorHtml,
  loadingHtml,
  loadingStageScript,
  loadingStatusScript,
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

  it("plays the intro by default and settles it for mid-session pages", () => {
    assert.match(loadingHtml(), /<html lang="en">/);
    assert.match(
      loadingHtml({ status: "Reconnecting", playIntro: false }),
      /<html lang="en" data-splash-intro="settled">/,
    );
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

describe("loading status scripts", () => {
  it("targets the splash status node", () => {
    assert.match(
      loadingStatusScript("Preparing"),
      /getElementById\("startup-splash-status"\)/,
    );
  });

  it("restarts the swap animation for every status change", () => {
    for (const script of [
      loadingStatusScript("Preparing"),
      loadingStageScript("preparing"),
    ]) {
      assert.match(script, /classList\.remove\("is-swapping"\)/);
      assert.match(script, /classList\.add\("is-swapping"\)/);
      assert.match(script, /status\.textContent = "Prepar/);
    }
  });

  it("completes the meter only on the final stage", () => {
    assert.match(
      loadingStageScript("opening"),
      /classList\.add\("is-complete"\)/,
    );
    assert.doesNotMatch(
      loadingStageScript("preparing"),
      /classList\.add\("is-complete"\)/,
    );
  });
});
