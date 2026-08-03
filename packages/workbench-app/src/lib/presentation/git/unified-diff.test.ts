import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnifiedDiff } from "./unified-diff";

describe("parseUnifiedDiff", () => {
  it("tracks old and new line numbers through a hunk", () => {
    const lines = parseUnifiedDiff(
      [
        "diff --git a/file.ts b/file.ts",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -10,3 +10,4 @@",
        " context",
        "-removed",
        "+added",
        "+another",
        " trailing",
      ].join("\n"),
    );

    assert.deepEqual(
      lines.slice(3).map(({ tone, oldLine, newLine }) => ({
        tone,
        oldLine,
        newLine,
      })),
      [
        { tone: "hunk", oldLine: undefined, newLine: undefined },
        { tone: "context", oldLine: 10, newLine: 10 },
        { tone: "delete", oldLine: 11, newLine: undefined },
        { tone: "add", oldLine: undefined, newLine: 11 },
        { tone: "add", oldLine: undefined, newLine: 12 },
        { tone: "context", oldLine: 12, newLine: 13 },
      ],
    );
  });

  it("does not number patch metadata or no-newline markers", () => {
    const lines = parseUnifiedDiff(
      [
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "diff --git a/next.ts b/next.ts",
        "index abc..def 100644",
      ].join("\n"),
    );

    assert.deepEqual(
      lines.map(({ oldLine, newLine }) => [oldLine, newLine]),
      [
        [undefined, undefined],
        [1, undefined],
        [undefined, undefined],
        [undefined, 1],
        [undefined, undefined],
        [undefined, undefined],
      ],
    );
  });
});
