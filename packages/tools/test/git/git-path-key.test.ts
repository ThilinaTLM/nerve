import assert from "node:assert/strict";
import { test } from "node:test";
import { gitPathKey } from "../../src/git/git-path-key.js";

void test("Windows drive and UNC extended-prefix/case/separator spellings share identity on any host", () => {
  const pairs = [
    ["C:\\Work\\Repo\\.git", "\\\\?\\c:\\work\\repo\\.git"],
    ["c:/WORK/REPO/.git/", "C:\\work\\repo\\.GIT"],
    ["\\\\Server\\Share\\Repo\\.git", "\\\\?\\UNC\\server\\share\\repo\\.git"],
    ["//?/UNC/SERVER/SHARE/Repo/.git/", "//server/share/repo/.git"],
    ["\\\\?\\D:\\Work\\Repo\\..\\Repo\\.git", "d:/work/repo/.git"],
  ];
  for (const [node, native] of pairs)
    assert.equal(gitPathKey(node!, "win32"), gitPathKey(native!, "win32"));
  assert.notEqual(
    gitPathKey("C:\\repo\\.git", "win32"),
    gitPathKey("D:\\repo\\.git", "win32"),
  );
  assert.notEqual(
    gitPathKey("C:\\repo\\.git", "win32"),
    gitPathKey("\\\\server\\share\\repo\\.git", "win32"),
  );
});
void test("POSIX identity preserves case, Unicode spelling and backslash filename characters", () => {
  assert.notEqual(
    gitPathKey("/Repo/.git", "linux"),
    gitPathKey("/repo/.git", "linux"),
  );
  assert.notEqual(
    gitPathKey("/repo\\name/.git", "linux"),
    gitPathKey("/repo/name/.git", "linux"),
  );
  assert.notEqual(
    gitPathKey("/caf\u00e9/.git", "linux"),
    gitPathKey("/cafe\u0301/.git", "linux"),
  );
  assert.equal(gitPathKey("/repo/a/../.git/", "linux"), "/repo/.git");
  assert.equal(gitPathKey("/", "linux"), "/");
});
void test("repository-path normalization cannot be used for synthetic admission IDs", () => {
  assert.throws(() => gitPathKey("git-network:1", "win32"), /absolute/);
  assert.throws(() => gitPathKey("native-git-read:1", "linux"), /absolute/);
});
