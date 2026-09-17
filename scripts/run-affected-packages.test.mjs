import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePackages,
  pnpmArguments,
  runAffectedPackages,
} from "./run-affected-packages.mjs";

test("package JSON is validated, deduplicated, and sorted", () => {
  assert.deepEqual(
    parsePackages(
      '["@nervekit/tools","@nervekit/contracts","@nervekit/tools"]',
    ),
    ["@nervekit/contracts", "@nervekit/tools"],
  );
  assert.throws(
    () => parsePackages('["@nervekit/tools; echo unsafe"]'),
    /Invalid/,
  );
  assert.throws(() => parsePackages("{}"), /array/);
});

test("pnpm receives package names as separate arguments", () => {
  assert.deepEqual(
    pnpmArguments("test", ["@nervekit/contracts", "@nervekit/protocol"]),
    [
      "--filter",
      "@nervekit/contracts",
      "--filter",
      "@nervekit/protocol",
      "--if-present",
      "test",
    ],
  );
  assert.throws(() => pnpmArguments("publish", []), /Unsupported/);
});

test("runner skips empty selections and propagates pnpm failures", () => {
  let calls = 0;
  runAffectedPackages("check", [], () => {
    calls += 1;
  });
  assert.equal(calls, 0);

  assert.throws(
    () =>
      runAffectedPackages("check", ["@nervekit/contracts"], () => ({
        status: 2,
      })),
    /exit code 2/,
  );
});
