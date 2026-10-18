import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  GitService,
  type GitRemoteCacheChange,
} from "../../src/git/git-service.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
  for (let count = 0; count < 100; count++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("cache did not settle");
}

void test("Git cache settlement is project-scoped across aliases and subscriptions see settled stale failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-github-cache-unit-"));
  const events: GitRemoteCacheChange[] = [];
  const service = new GitService(() => ({
    dir: root,
    name: "Synthetic project",
  }));
  let loads = 0;
  let fail = false;
  service.listOpenPrs = async () => {
    loads++;
    if (fail) throw new Error("token=synthetic-private-output");
    return { prs: [] };
  };
  try {
    await mkdir(join(root, "real", ".git"), { recursive: true });
    await symlink(
      join(root, "real"),
      join(root, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    service.onRemoteCacheChanged(() => {
      throw new Error("subscriber failure");
    });
    const unsubscribe = service.onRemoteCacheChanged((change) => {
      const snapshot = service.cachedOpenPrs(change.projectId, "alias");
      assert.equal(snapshot.refreshing, false);
      assert.ok(snapshot.status === "fresh" || snapshot.status === "stale");
      events.push(change);
    });
    assert.equal(service.cachedOpenPrs("proj_a", "real").status, "loading");
    assert.equal(service.cachedOpenPrs("proj_a", "alias").status, "loading");
    assert.equal(service.cachedOpenPrs("proj_b", "alias").status, "loading");
    await until(() => events.length === 2);
    assert.equal(
      loads,
      2,
      "same-project aliases coalesce; distinct projects retain separate scope",
    );
    assert.deepEqual(events.map((event) => event.projectId).sort(), [
      "proj_a",
      "proj_b",
    ]);
    assert.ok(events.every((event) => event.source === "pull_requests"));
    const previous = service.cachedOpenPrs("proj_a", "real");
    fail = true;
    const pending = service.cachedOpenPrs("proj_a", "alias", true);
    assert.equal(pending.status, "stale");
    assert.equal(pending.refreshing, true);
    await until(() => events.length === 3);
    const stale = service.cachedOpenPrs("proj_a", "real");
    assert.equal(stale.status, "stale");
    assert.equal(stale.refreshing, false);
    assert.deepEqual(stale.result, previous.result);
    assert.equal(stale.updatedAt, previous.updatedAt);
    assert.deepEqual(events[2], {
      projectId: "proj_a",
      source: "pull_requests",
    });
    unsubscribe();
    service.cachedOpenPrs("proj_a", "real", true);
    await tick();
    await tick();
    assert.equal(events.length, 3);
  } finally {
    await service.closeRemoteCaches();
    await rm(root, { recursive: true, force: true });
  }
});
