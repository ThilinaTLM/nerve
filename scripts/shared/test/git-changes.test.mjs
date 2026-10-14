import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { isIgnoredPath, readGitState } from "../git-changes.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nerve-git-changes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, text = "export {};") {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, write };
}

test("Git discovery includes branch, staged, unstaged, untracked, and renamed paths with spaces", (t) => {
  const f = fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: f.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  f.write(".gitignore", "ignored.ts\n");
  f.write("staged.ts");
  f.write("unstaged.ts");
  f.write("old name.ts");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  f.write("branch.ts");
  git("add", ".");
  git("commit", "-qm", "branch");
  f.write("staged.ts", "export const staged = 1;");
  git("add", "staged.ts");
  f.write("unstaged.ts", "export const unstaged = 1;");
  git("mv", "old name.ts", "new name.ts");
  f.write("untracked file.ts");
  f.write("ignored.ts");
  f.write("packages/example/dist/generated.js");
  f.write("packages/example/src/kept.ts");
  // A staged edit undone in the worktree still belongs to staged change discovery.
  f.write("staged.ts", "export {};");
  const state = readGitState(f.root, base);
  assert.deepEqual(state.paths, [
    "branch.ts",
    "new name.ts",
    "old name.ts",
    "packages/example/dist/generated.js",
    "packages/example/src/kept.ts",
    "staged.ts",
    "unstaged.ts",
    "untracked file.ts",
  ]);
  assert.equal(state.deleted.has("old name.ts"), true);
  assert.equal(state.files.includes("old name.ts"), false);
  assert.equal(state.files.includes("ignored.ts"), false);
  assert.equal(
    state.files.includes("packages/example/dist/generated.js"),
    false,
  );
  assert.equal(state.files.includes("packages/example/src/kept.ts"), true);
  assert.equal(state.base, base);
  assert.equal(state.baseline, base);
  assert.throws(() => readGitState(f.root, "missing-base"));
  assert.equal(readGitState(f.root, "HEAD").paths.includes("branch.ts"), false);
});

test("ignored inventory paths exclude generated output without excluding source paths", () => {
  for (const path of [
    "node_modules/dependency/index.js",
    "packages/example/node_modules/dependency/index.js",
    ".git/config",
    "target/output",
    ...[
      "dist",
      "prebuilds",
      ".svelte-kit",
      ".astro",
      ".vite",
      "release",
      "build",
      "native/target",
    ].map((directory) => `packages/example/${directory}/output.js`),
  ]) {
    assert.equal(isIgnoredPath(path), true, path);
  }
  for (const path of [
    "packages/example/src/index.ts",
    "packages/example/src/build/index.ts",
    "packages/example/distinct/index.ts",
    "scripts/build/index.mjs",
  ]) {
    assert.equal(isIgnoredPath(path), false, path);
  }
});
