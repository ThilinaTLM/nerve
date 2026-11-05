import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitProjectFileStatus } from "@nervekit/contracts/git";
import {
  fileGitDecoration,
  fileTreeGitDecoration,
  indexFileTreeGitDecorations,
  indexProjectFileStatuses,
  isFileEntryDimmed,
  parentDirectory,
} from "./file-git-status";

function status(
  patch: Partial<GitProjectFileStatus> = {},
): GitProjectFileStatus {
  return {
    repo: ".",
    path: "src/index.ts",
    index: " ",
    worktree: " ",
    staged: false,
    untracked: false,
    ...patch,
  };
}

describe("file Git decorations", () => {
  it("indexes status by project-relative path", () => {
    const file = status();
    assert.equal(indexProjectFileStatuses([file]).get(file.path), file);
  });

  it("aggregates the highest-priority color into parent folders", () => {
    const decorations = indexFileTreeGitDecorations([
      status({ path: "src/new.ts", untracked: true }),
      status({ path: "src/nested/changed.ts", worktree: "M" }),
    ]);
    assert.equal(decorations.get("src/new.ts")?.tone, "success");
    assert.equal(decorations.get("src/nested")?.tone, "warning");
    assert.equal(decorations.get("src")?.tone, "warning");
  });

  it("matches directory statuses reported with a trailing slash", () => {
    const decorations = indexFileTreeGitDecorations([
      status({ path: "packages/new-tool/", untracked: true }),
    ]);
    assert.equal(decorations.get("packages/new-tool")?.tone, "success");
    assert.equal(decorations.get("packages")?.tone, "success");
  });

  it("mutes ignored entries, their descendants, and Git metadata", () => {
    const decorations = indexFileTreeGitDecorations([
      status({ path: "release", index: "!", worktree: "!" }),
    ]);
    assert.equal(
      fileTreeGitDecoration(decorations, "release/npm/archive.tgz")?.tone,
      "neutral",
    );
    assert.equal(fileTreeGitDecoration(decorations, ".git")?.tone, "neutral");
    assert.equal(
      fileTreeGitDecoration(decorations, ".github/workflows/ci.yml"),
      undefined,
    );
  });

  it("uses semantic labels and precedence", () => {
    assert.deepEqual(fileGitDecoration(status({ untracked: true })), {
      label: "U",
      title: "Untracked",
      class: "text-success",
      tone: "success",
    });
    assert.equal(fileGitDecoration(status({ index: "A" }))?.label, "A");
    assert.equal(fileGitDecoration(status({ worktree: "M" }))?.label, "M");
    assert.equal(fileGitDecoration(status({ index: "R" }))?.label, "R");
    assert.equal(fileGitDecoration(status({ worktree: "D" }))?.label, "D");
    assert.equal(
      fileGitDecoration(status({ index: "U", worktree: "M" }))?.label,
      "!",
    );
  });

  it("returns an empty parent for top-level paths", () => {
    assert.equal(parentDirectory("package.json"), "");
    assert.equal(parentDirectory("src/a.ts"), "src");
  });

  it("never lets an ignored top-level path decorate unrelated names by prefix", () => {
    // `data` and `target` used to leave "d" and "t" decorations behind
    // (slice(0, -1) when there is no "/"), dimming docs, tests, tsconfig…
    const decorations = indexFileTreeGitDecorations([
      status({ path: "data", index: "!", worktree: "!" }),
      status({ path: "target", index: "!", worktree: "!" }),
      status({ path: ".ruff_cache/0.15", index: "!", worktree: "!" }),
    ]);
    for (const path of ["docs", "tests", "tsconfig.json", ".github", ".nvmrc"])
      assert.equal(fileTreeGitDecoration(decorations, path), undefined, path);
    assert.equal(fileTreeGitDecoration(decorations, "data")?.ignored, true);
  });

  it("does not mark ancestors of an ignored path as ignored", () => {
    // `.nerve/*` is ignored but `.nerve/skills` is tracked; only a pycache
    // inside the skills is ignored.
    const decorations = indexFileTreeGitDecorations([
      status({ path: ".nerve/config", index: "!", worktree: "!" }),
      status({
        path: ".nerve/skills/nerve-debug/scripts/__pycache__",
        index: "!",
        worktree: "!",
      }),
    ]);
    for (const path of [
      ".nerve",
      ".nerve/skills",
      ".nerve/skills/nerve-debug",
      ".nerve/skills/SKILL.md",
    ])
      assert.equal(fileTreeGitDecoration(decorations, path), undefined, path);
    assert.equal(
      fileTreeGitDecoration(decorations, ".nerve/config")?.ignored,
      true,
    );
    // Contents of an ignored directory inherit it.
    assert.equal(
      fileTreeGitDecoration(decorations, ".nerve/config/permissions.json")
        ?.ignored,
      true,
    );
  });

  it("still propagates status tones to ancestors", () => {
    const decorations = indexFileTreeGitDecorations([
      status({ path: ".nerve/skills/a.md", worktree: "M" }),
      status({ path: ".nerve/config", index: "!", worktree: "!" }),
    ]);
    assert.equal(decorations.get(".nerve/skills")?.tone, "warning");
    assert.equal(decorations.get(".nerve")?.tone, "warning");
  });

  it("dims from the listing flag, using Git only when the listing has none", () => {
    const ignored = fileTreeGitDecoration(
      indexFileTreeGitDecorations([
        status({ path: "dist", index: "!", worktree: "!" }),
      ]),
      "dist",
    );
    assert.equal(isFileEntryDimmed({ ignored: false }, ignored), false);
    assert.equal(isFileEntryDimmed({ ignored: true }, undefined), true);
    assert.equal(isFileEntryDimmed({}, ignored), true);
    assert.equal(isFileEntryDimmed({}, undefined), false);
  });
});
