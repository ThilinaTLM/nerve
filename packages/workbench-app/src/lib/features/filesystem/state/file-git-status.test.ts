import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitProjectFileStatus } from "@nervekit/contracts";
import {
  fileGitDecoration,
  fileTreeGitDecoration,
  indexFileTreeGitDecorations,
  indexProjectFileStatuses,
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

  it("mutes ignored entries, their descendants, and Git metadata", () => {
    const decorations = indexFileTreeGitDecorations([
      status({ path: "release", index: "!", worktree: "!" }),
    ]);
    assert.equal(
      fileTreeGitDecoration(decorations, "release/npm/archive.tgz")?.tone,
      "muted",
    );
    assert.equal(fileTreeGitDecoration(decorations, ".git")?.tone, "muted");
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
});
