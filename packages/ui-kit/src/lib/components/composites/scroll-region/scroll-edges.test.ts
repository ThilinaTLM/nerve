import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrollEdges } from "./scroll-edges";

describe("scrollEdges", () => {
  it("reports no edges when the content fits", () => {
    assert.deepEqual(
      scrollEdges({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 }),
      { top: false, bottom: false },
    );
  });

  it("reports only the bottom edge at the start of a long list", () => {
    assert.deepEqual(
      scrollEdges({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 }),
      { top: false, bottom: true },
    );
  });

  it("reports both edges mid-scroll", () => {
    assert.deepEqual(
      scrollEdges({ scrollTop: 200, clientHeight: 300, scrollHeight: 900 }),
      { top: true, bottom: true },
    );
  });

  it("reports only the top edge at the end of a long list", () => {
    assert.deepEqual(
      scrollEdges({ scrollTop: 600, clientHeight: 300, scrollHeight: 900 }),
      { top: true, bottom: false },
    );
  });

  it("ignores sub-threshold offsets", () => {
    assert.deepEqual(
      scrollEdges({ scrollTop: 1.5, clientHeight: 300, scrollHeight: 301 }),
      { top: false, bottom: false },
    );
  });

  it("does not flicker on fractional scroll heights", () => {
    assert.deepEqual(
      scrollEdges({
        scrollTop: 599.5,
        clientHeight: 300.4,
        scrollHeight: 900.2,
      }),
      { top: true, bottom: false },
    );
  });
});
