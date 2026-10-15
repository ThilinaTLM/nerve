import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { isIgnoredPath, readGitFile, readGitState } from "../git-changes.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nerve-git-changes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, text = "export {};") {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return { root, write, git };
}

function baselineFixture(t) {
  const f = fixture(t);
  f.git("init", "-q");
  f.git("config", "user.email", "test@example.invalid");
  f.git("config", "user.name", "Test");
  f.write("file with spaces.json", '{"version": "baseline"}\n');
  f.write("nested/empty.txt", "");
  f.write("literal[1].txt", "literal\n");
  f.git("add", ".");
  f.git("commit", "-qm", "baseline");
  return { ...f, baseline: f.git("rev-parse", "HEAD") };
}

test("baseline reader returns exact committed text, including spaced and literal filenames", (t) => {
  const f = baselineFixture(t);
  assert.equal(
    readGitFile(f.root, f.baseline, "file with spaces.json"),
    '{"version": "baseline"}\n',
  );
  assert.equal(readGitFile(f.root, f.baseline, "nested/empty.txt"), "");
  assert.equal(readGitFile(f.root, f.baseline, "literal[1].txt"), "literal\n");
});

test("baseline reader returns null only for absent files at a valid baseline", (t) => {
  const f = baselineFixture(t);
  f.write("new file.json", "{}");
  f.git("add", "new file.json");
  assert.equal(readGitFile(f.root, f.baseline, "new file.json"), null);
  assert.equal(readGitFile(f.root, f.baseline, "missing/file.json"), null);
  assert.throws(() => readGitFile(f.root, f.baseline, "nested"), /not a file/);
});

test("baseline reader propagates invalid revisions and unavailable repositories", (t) => {
  const f = baselineFixture(t);
  for (const revision of [
    "missing-revision",
    "--help",
    "HEAD:file with spaces.json",
  ]) {
    assert.throws(() => readGitFile(f.root, revision, "missing.json"));
  }
  const unavailable = fixture(t);
  assert.throws(() =>
    readGitFile(unavailable.root, f.baseline, "missing.json"),
  );
});

test("baseline reader ignores later commits, staged edits, and worktree edits", (t) => {
  const f = baselineFixture(t);
  const path = "file with spaces.json";
  f.write(path, '{"version": "later commit"}\n');
  f.git("add", path);
  f.git("commit", "-qm", "later");
  f.write(path, '{"version": "staged"}\n');
  f.git("add", path);
  f.write(path, '{"version": "worktree"}\n');
  assert.equal(
    readGitFile(f.root, f.baseline, path),
    '{"version": "baseline"}\n',
  );
  rmSync(join(f.root, path));
  assert.equal(
    readGitFile(f.root, f.baseline, path),
    '{"version": "baseline"}\n',
  );
});

test("Git discovery includes branch, staged, unstaged, untracked, and renamed paths with spaces", (t) => {
  const f = fixture(t);
  const { git } = f;
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
