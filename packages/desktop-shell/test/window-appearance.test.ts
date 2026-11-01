import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_WINDOW_APPEARANCE,
  createWindowAppearanceStore,
  parseWindowAppearance,
  readWindowAppearance,
} from "../src/window/window-appearance.js";
import { errorHtml, loadingHtml } from "../src/window/loading-pages.js";

function memoryFiles(initial?: string) {
  const state = { contents: initial, writes: 0 };
  return {
    state,
    read: () => {
      if (state.contents === undefined) throw new Error("ENOENT");
      return state.contents;
    },
    write: (_path: string, contents: string) => {
      state.contents = contents;
      state.writes += 1;
    },
  };
}

describe("window appearance", () => {
  it("accepts only a hex background and a boolean", () => {
    assert.deepEqual(
      parseWindowAppearance({ background: "#FAF8F1", dark: false }),
      { background: "#faf8f1", dark: false },
    );
    for (const value of [
      null,
      "x",
      { background: "red", dark: true },
      { background: "#fff", dark: true },
      { background: "#272521", dark: "yes" },
      { dark: true },
    ])
      assert.equal(parseWindowAppearance(value), undefined);
  });

  it("reads a stored file and ignores missing or corrupt ones", () => {
    const valid = memoryFiles('{"background":"#111111","dark":true}');
    assert.deepEqual(readWindowAppearance("p", valid), {
      background: "#111111",
      dark: true,
    });
    assert.equal(readWindowAppearance("p", memoryFiles()), undefined);
    assert.equal(readWindowAppearance("p", memoryFiles("{nope")), undefined);
  });

  it("defaults to nerve-dark without a stored value", () => {
    const store = createWindowAppearanceStore("/u", memoryFiles());
    assert.deepEqual(store.current(), DEFAULT_WINDOW_APPEARANCE);
    assert.deepEqual(DEFAULT_WINDOW_APPEARANCE, {
      background: "#272521",
      dark: true,
    });
  });

  it("prefers the stored value and writes only when it changes", () => {
    const files = memoryFiles('{"background":"#faf8f1","dark":false}');
    const store = createWindowAppearanceStore("/u", files);
    assert.equal(store.current().background, "#faf8f1");
    store.update({ background: "#faf8f1", dark: false });
    assert.equal(files.state.writes, 0);
    store.update({ background: "#272521", dark: true });
    store.update({ background: "#272521", dark: true });
    assert.equal(files.state.writes, 1);
    assert.deepEqual(JSON.parse(files.state.contents ?? ""), {
      background: "#272521",
      dark: true,
    });
    assert.equal(store.update({ background: "bad", dark: true }), undefined);
    assert.equal(files.state.writes, 1);
    assert.equal(store.current().background, "#272521");
  });

  it("themes the loading and error pages from the appearance", () => {
    const light = { background: "#faf8f1", dark: false };
    const dark = { background: "#222222", dark: true };
    assert.match(loadingHtml({ appearance: light }), /data-mode="light"/);
    const darkPage = loadingHtml({ appearance: dark });
    assert.match(darkPage, /data-mode="dark"/);
    assert.match(darkPage, /--background: #222222/);
    assert.match(loadingHtml(), /data-mode="dark"/);
    assert.match(
      errorHtml(new Error("x"), "~", { appearance: light }),
      /data-mode="light"/,
    );
    assert.doesNotMatch(darkPage, /prefers-color-scheme/);
  });
});
