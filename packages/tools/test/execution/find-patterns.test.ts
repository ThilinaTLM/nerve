import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeFind } from "../../src/execution/filesystem/find.js";
import { createTempProject } from "../support/project-fixtures.js";

const FILES = [
  "a.ts",
  "README.md",
  ".hidden/e.ts",
  "src/b.ts",
  "src/b.md",
  "src/deep/c.ts",
  "src/deep/er/d.ts",
  "test/b.test.ts",
];

const EXPECTED: Record<string, string[]> = {
  "*.ts": [
    ".hidden/e.ts",
    "a.ts",
    "src/b.ts",
    "src/deep/c.ts",
    "src/deep/er/d.ts",
    "test/b.test.ts",
  ],
  "b.*": ["src/b.md", "src/b.ts", "test/b.test.ts"],
  "b.ts": ["src/b.ts"],
  "*.test.ts": ["test/b.test.ts"],
  "b.?s": ["src/b.ts"],
  "src/*.ts": ["src/b.ts"],
  "src/**/*.ts": ["src/b.ts", "src/deep/c.ts", "src/deep/er/d.ts"],
  "**/*.ts": [
    ".hidden/e.ts",
    "a.ts",
    "src/b.ts",
    "src/deep/c.ts",
    "src/deep/er/d.ts",
    "test/b.test.ts",
  ],
  "deep/*.ts": ["src/deep/c.ts"],
  "test/*": ["test/b.test.ts"],
  "src/deep/c.ts": ["src/deep/c.ts"],
};

describe("find pattern semantics", () => {
  it("matches names without a slash and full paths with one, in path order", async () => {
    const project = await createTempProject();
    for (const file of FILES) await project.write(file, "x");
    for (const [pattern, expected] of Object.entries(EXPECTED)) {
      const result = await executeFind(
        { pattern, limit: 100 },
        { cwd: project.root },
      );
      assert.deepEqual(
        (result.entries ?? []).map((entry) => entry.path),
        expected,
        pattern,
      );
    }
  });
});
