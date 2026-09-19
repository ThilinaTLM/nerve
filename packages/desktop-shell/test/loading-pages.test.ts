import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

describe("loading status scripts", () => {
  it("targets the splash status node", () => {
    assert.match(
      loadingStatusScript("Preparing"),
      /getElementById\("startup-splash-status"\)/,
    );
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
