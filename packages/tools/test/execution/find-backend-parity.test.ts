import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { executeFindWithBackend } from "../../src/execution/filesystem/find.js";
import { createTempProject } from "../support/project-fixtures.js";

function fdAvailable(): boolean {
  try {
    execFileSync("fd", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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

const PATTERNS = [
  "*.ts",
  "b.*",
  "b.ts",
  "*.test.ts",
  "b.?s",
  "src/*.ts",
  "src/**/*.ts",
  "**/*.ts",
  "src/**",
  "deep/*.ts",
  "test/*",
  "src/deep/c.ts",
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
  "src/*.ts": ["src/b.ts"],
  "src/**/*.ts": ["src/b.ts", "src/deep/c.ts", "src/deep/er/d.ts"],
  "deep/*.ts": ["src/deep/c.ts"],
};

async function find(
  root: string,
  pattern: string,
  backend: "fd" | "node",
): Promise<string[]> {
  const result = await executeFindWithBackend(
    { pattern, limit: 100 },
    { cwd: root },
    backend,
  );
  return (result.entries ?? []).map((entry) => entry.path).sort();
}

describe("find backends", () => {
  it("the Node fallback matches the documented pattern semantics", async () => {
    const project = await createTempProject();
    for (const file of FILES) await project.write(file, "x");
    for (const [pattern, expected] of Object.entries(EXPECTED)) {
      assert.deepEqual(
        await find(project.root, pattern, "node"),
        expected,
        pattern,
      );
    }
  });

  it("fd and the Node fallback return the same files", async (t) => {
    if (!fdAvailable()) {
      t.skip("fd is not installed");
      return;
    }
    const project = await createTempProject();
    for (const file of FILES) await project.write(file, "x");
    for (const pattern of PATTERNS) {
      assert.deepEqual(
        await find(project.root, pattern, "node"),
        await find(project.root, pattern, "fd"),
        pattern,
      );
    }
  });
});
