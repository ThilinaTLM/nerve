import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCodeQuality,
  renderCodeQualityReport,
} from "./lib/code-quality-report.mjs";

function inventory(entries) {
  const contents = new Map(Object.entries(entries));
  return {
    files: [...contents.keys()].reverse(),
    read(file) {
      return contents.get(file);
    },
  };
}

test("separates production, colocated tests, and Rust while excluding generated artifacts", () => {
  const report = analyzeCodeQuality(
    inventory({
      "packages/example/package.json": JSON.stringify({
        name: "@nervekit/example",
        scripts: { test: 'tsx --test "src/**/*.test.ts"' },
      }),
      "packages/example/src/main.ts": "export const value = 1;\n",
      "packages/example/src/a file.test.ts": "test();\nassert();\n",
      "packages/example/test/fixture.ts": "export const fixture = true;",
      "packages/example/dist/generated.ts": "generated();\n",
      "packages/native/native/src/lib.rs": "pub fn value() {}\n",
      "packages/native/prebuilds/local/index.js": "generated();\n",
    }),
  );

  assert.deepEqual(report.packages, [
    {
      package: "example",
      production: { files: 1, lines: 1 },
      test: { files: 2, lines: 3 },
    },
    {
      package: "native",
      production: { files: 1, lines: 1 },
      test: { files: 0, lines: 0 },
    },
  ]);
  assert.deepEqual(report.testCommands, [
    {
      package: "@nervekit/example",
      command: 'tsx --test "src/**/*.test.ts"',
    },
  ]);
});

test("reports large files and review signals deterministically", () => {
  const largeSource = [
    "/* eslint-disable max-lines */",
    "const value = source as unknown as Value;",
    "// @ts-expect-error fixture",
    ...Array.from({ length: 798 }, () => "value();"),
  ].join("\n");
  const report = analyzeCodeQuality(
    inventory({
      "scripts/z.mjs": "export {};\n",
      "packages/z/src/large.ts": largeSource,
      "packages/a/src/a.ts": "export {};\n",
    }),
  );

  assert.deepEqual(report.largeFiles, [
    { file: "packages/z/src/large.ts", lines: 801 },
  ]);
  assert.deepEqual(report.signals.eslintDisable, [
    { file: "packages/z/src/large.ts", line: 1 },
  ]);
  assert.deepEqual(report.signals.unsafeDoubleAssertion, [
    { file: "packages/z/src/large.ts", line: 2 },
  ]);
  assert.deepEqual(report.signals.tsDirective, [
    { file: "packages/z/src/large.ts", line: 3 },
  ]);

  const first = renderCodeQualityReport(report);
  const second = renderCodeQualityReport(
    analyzeCodeQuality(
      inventory({
        "packages/a/src/a.ts": "export {};\n",
        "packages/z/src/large.ts": largeSource,
        "scripts/z.mjs": "export {};\n",
      }),
    ),
  );
  assert.equal(first, second);
  assert.match(
    first,
    /syntactic review signals, not defect or quality scores/i,
  );
});
