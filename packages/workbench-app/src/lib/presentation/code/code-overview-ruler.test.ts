import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overviewRows } from "./code-overview-ruler";

// Ten 20px lines; positions are line indexes for simplicity.
const geometry = {
  trackHeight: 100,
  scrollHeight: 200,
  blockTop: (position: number) => position * 20,
  blockBottom: (position: number) => position * 20 + 20,
};

describe("overview ruler rows", () => {
  it("scales marks onto the track", () => {
    assert.deepEqual(
      overviewRows([{ from: 2, to: 3, kind: "modified" }], geometry),
      [{ kind: "modified", top: 20, height: 20, position: 2 }],
    );
  });

  it("draws empty ranges as a minimum-height tick", () => {
    assert.deepEqual(
      overviewRows([{ from: 5, to: 5, kind: "deleted" }], geometry),
      [{ kind: "deleted", top: 50, height: 2, position: 5 }],
    );
  });

  it("merges overlapping marks of the same kind only", () => {
    const rows = overviewRows(
      [
        { from: 0, to: 0, kind: "search" },
        { from: 0, to: 0, kind: "added" },
        { from: 0, to: 1, kind: "search" },
        { from: 8, to: 8, kind: "search" },
      ],
      geometry,
    );
    assert.deepEqual(
      rows.map((row) => [row.kind, row.top, row.height]),
      [
        ["search", 0, 20],
        ["added", 0, 2],
        ["search", 80, 2],
      ],
    );
  });

  it("does not stretch short documents past the track", () => {
    const rows = overviewRows([{ from: 1, to: 1, kind: "target" }], {
      ...geometry,
      scrollHeight: 50,
    });
    assert.equal(rows[0]?.top, 20);
  });
});
