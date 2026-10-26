import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

const runner = fileURLToPath(new URL("./run-tests.mjs", import.meta.url));

function fixture(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "workbench-tests-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return {
    write(path: string, source: string) {
      const file = join(cwd, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    },
    run(...args: string[]) {
      // Do not inherit the outer node:test child-process context.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, [runner, ...args], {
        cwd,
        env,
        encoding: "utf8",
      });
    },
  };
}

const passingTest = `
import { test } from "node:test";
const label: string = "typescript fixture";
test(label, () => {});
`;

test("discovers TypeScript tests but excludes only local wireframes", (t) => {
  const files = fixture(t);
  files.write("src/product.test.ts", passingTest);
  files.write("src/lib/app/design-lab/catalog.test.ts", passingTest);
  files.write(
    "src/lib/app/design-lab/wireframes-other/kept.test.ts",
    passingTest,
  );
  files.write("scripts/runner.test.ts", passingTest);
  files.write(
    "src/lib/app/design-lab/wireframes/ignored.test.ts",
    "throw Error('wireframe ran');",
  );
  files.write(
    "src/lib/app/design-lab/wireframes/nested/ignored.test.ts",
    "throw Error('nested wireframe ran');",
  );
  const result = files.run("--test-reporter=tap");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# tests 4\b/);
  assert.doesNotMatch(result.stdout + result.stderr, /wireframe ran/);
});

test("preserves node:test failure status", (t) => {
  const files = fixture(t);
  files.write(
    "src/failing.test.ts",
    'import { test } from "node:test"; test("failure", () => { throw Error("expected failure"); });',
  );
  const result = files.run("--test-reporter=tap");
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /expected failure/);
});

test("succeeds with no matches without triggering automatic discovery", (t) => {
  const files = fixture(t);
  files.write(
    "src/lib/app/design-lab/wireframes/ignored.test.ts",
    "throw Error('wireframe ran');",
  );
  files.write("unexpected.test.js", "throw Error('automatic discovery ran');");
  const result = files.run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
