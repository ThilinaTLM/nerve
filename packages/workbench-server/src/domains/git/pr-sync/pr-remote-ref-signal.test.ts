import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteRefBranches } from "./pr-remote-ref-signal.js";

void test("remote-ref signals distinguish branch evidence, packed refs, and unrelated git writes", () => {
  assert.deepEqual(
    remoteRefBranches([
      "/repo/.git/refs/remotes/origin/feature/one",
      "/repo/.git/refs/remotes/upstream/feature/one",
    ]),
    ["feature/one"],
  );
  assert.deepEqual(
    remoteRefBranches(["C:\\repo\\.git\\refs\\remotes\\origin\\main"]),
    ["main"],
  );
  assert.deepEqual(remoteRefBranches(["/repo/.git/packed-refs"]), []);
  assert.deepEqual(
    remoteRefBranches(["/repo/.git/refs/remotes/origin/HEAD"]),
    [],
  );
  assert.equal(
    remoteRefBranches([
      "/repo/.git/index",
      "/repo/.git/refs/heads/main",
      "/repo/.git/refs/remotes/origin/main.lock",
    ]),
    null,
  );
});
