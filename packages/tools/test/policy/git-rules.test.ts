import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedPlanModeBashCommand } from "../../src/policy/index.js";
import { assessShellCommand } from "../../src/policy/shell/assessment.js";

const readOnly = [
  "git status",
  "git reflog",
  "git reflog show",
  "git reflog main",
  "git reflog -n 10",
  "git --version",
  "git version",
  "git worktree list",
  "git stash list",
  "git stash show",
  "git tag",
  "git tag -l 'v*'",
  "git tag --list",
  "git tag -n",
  "git tag --contains HEAD",
  "git shortlog -sn",
  "git describe --tags",
  "git blame src/a.ts",
  "git ls-files",
  "git ls-tree HEAD",
  "git show-ref",
  "git merge-base a b",
  "git name-rev HEAD",
  "git for-each-ref",
  "git grep plan -- src",
  "git rev-parse HEAD",
  "git cat-file -p HEAD",
  "git branch",
  "git branch --list 'feat/*'",
  "git branch -a",
  "git branch --show-current",
  "git branch --contains HEAD",
  "git remote",
  "git remote -v",
  "git remote show origin",
  "git remote get-url origin",
  "git config --get remote.origin.url",
  "git config --list --show-origin",
  "git --no-pager log -1",
  "git -C . status && git diff --stat",
];

const needsApproval = [
  "git branch new-name",
  "git branch -c old new",
  "git branch -f x HEAD",
  "git branch --set-upstream-to=origin/x",
  "git branch -u origin/x",
  "git branch --unset-upstream",
  "git branch --edit-description",
  "git branch -D old",
  "git tag v1",
  "git tag -d v1",
  "git tag -a v1 -m x",
  "git tag -f v1",
  "git reflog expire --all",
  "git reflog delete HEAD@{1}",
  "git worktree add ../x",
  "git worktree remove x",
  "git stash",
  "git stash push",
  "git stash pop",
  "git stash drop",
  "git remote add origin x",
  "git remote set-url origin x",
  "git remote prune origin",
  "git config user.name Someone",
  "git config --get x --unset",
  "git config --list --edit",
  "git log --output=f",
  "git show --output f",
  "git diff --ext-diff",
  "git diff --output patch.txt",
  "git grep -O less foo",
  "git cat-file --batch",
  "git -c core.pager=cmd log",
  "git -c alias.x='!cmd' x",
  "git --exec-path=/tmp status",
  "git archive HEAD -o a.tar",
  "git format-patch -o out HEAD~1",
  "git update-ref refs/heads/x HEAD",
  "git update-index --add a",
  "git symbolic-ref HEAD refs/heads/x",
  "git hash-object -w a",
  "git notes add -m x",
  "git replace a b",
  "git prune",
  "git repack",
  "git maintenance run",
  "git sparse-checkout set x",
  "git fsck",
  "git lfs pull",
  "git myalias",
  "git checkout main",
  "git switch main",
  "git reset --hard",
  "git clean -fd",
  "git commit -m x",
  "git push",
  "git merge x",
  "git rebase x",
];

describe("git read-only allowlist", () => {
  for (const command of readOnly) {
    it(`read-only: ${command}`, () => {
      assert.equal(assessShellCommand(command).risk, "read");
      assert.equal(isAllowedPlanModeBashCommand(command), true);
    });
  }
  for (const command of needsApproval) {
    it(`needs approval: ${command}`, () => {
      assert.notEqual(assessShellCommand(command).risk, "read");
      assert.equal(isAllowedPlanModeBashCommand(command), false);
    });
  }
});
