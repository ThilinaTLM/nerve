import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computedLineHeightPixels,
  contentWidthFromBorderBox,
  nextFixedVisibleRows,
  parseCssPixels,
  visualRowsFromScrollHeight,
} from "./result-code-block-sizing";

describe("result code block fixed-row sizing", () => {
  it("parses pixel values and falls back for non-pixel computed styles", () => {
    assert.equal(parseCssPixels("10px"), 10);
    assert.equal(parseCssPixels("1.5px"), 1.5);
    assert.equal(parseCssPixels("normal", 7), 7);
    assert.equal(parseCssPixels(undefined, 3), 3);
  });

  it("derives line-height from pixels or font-size fallback", () => {
    assert.equal(computedLineHeightPixels("18px", "12px"), 18);
    assert.equal(computedLineHeightPixels("normal", "10px"), 14);
    assert.equal(computedLineHeightPixels("normal", "bad", 20), 28);
  });

  it("derives content width by excluding padding and borders", () => {
    assert.equal(
      contentWidthFromBorderBox({
        borderBoxWidth: 242,
        paddingLeft: 10,
        paddingRight: 10,
        borderLeftWidth: 1,
        borderRightWidth: 1,
      }),
      220,
    );
  });

  it("converts measured wrapped content height into visual rows", () => {
    assert.equal(visualRowsFromScrollHeight(42, 14), 3);
    assert.equal(visualRowsFromScrollHeight(56, 14), 4);
    assert.equal(visualRowsFromScrollHeight(0, 14), 0);
  });

  it("ignores integer scroll-height rounding around fractional line heights", () => {
    assert.equal(visualRowsFromScrollHeight(43, 14), 3);
    assert.equal(visualRowsFromScrollHeight(132, 14.64), 9);
    assert.equal(visualRowsFromScrollHeight(146, 14.64), 10);
  });

  it("grows by measured visual rows, clamps at the fixed row cap, and never shrinks", () => {
    let rows = nextFixedVisibleRows({
      previousRows: 0,
      fallbackRows: 1,
      measuredRows: 4,
      fixedRows: 10,
    });
    assert.equal(rows, 4);

    rows = nextFixedVisibleRows({
      previousRows: rows,
      fallbackRows: 1,
      measuredRows: 14,
      fixedRows: 10,
    });
    assert.equal(rows, 10);

    rows = nextFixedVisibleRows({
      previousRows: rows,
      fallbackRows: 1,
      measuredRows: 2,
      fixedRows: 10,
    });
    assert.equal(rows, 10);
  });

  it("uses logical fallback rows when visual measurement is unavailable", () => {
    assert.equal(
      nextFixedVisibleRows({
        previousRows: 0,
        fallbackRows: 3,
        fixedRows: 10,
      }),
      3,
    );
  });
});
