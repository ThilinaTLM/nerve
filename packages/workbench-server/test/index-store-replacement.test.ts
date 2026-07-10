import assert from "node:assert/strict";
import { existsSync, renameSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/contracts";
import { IndexStore } from "../src/infrastructure/index-store/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

function event(seq: number): EventEnvelope {
  return {
    seq,
    id: `evt_${seq}`,
    ts: new Date().toISOString(),
    type: "test.event",
    durability: "durable",
    data: {},
  };
}

describe("IndexStore fresh replacement", () => {
  it("can roll back or commit while keeping the same facade", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-index-replace-"));
    roots.push(root);
    const path = join(root, "state.sqlite");
    const index = new IndexStore(path);
    index.initialize();
    index.insertEvent(event(1));

    const rollback = index.beginFreshReplacement();
    assert.equal(index.counts().events, 0);
    index.insertEvent(event(2));
    index.rollbackFreshReplacement(rollback);
    assert.equal(index.counts().events, 1);
    assert.equal(index.latestEventSeq(), 1);

    const commit = index.beginFreshReplacement();
    index.insertEvent(event(3));
    index.commitFreshReplacement(commit);
    assert.equal(index.latestEventSeq(), 3);
    assert.equal(existsSync(`${path}.cleanup-backup`), false);
    index.close();
  });

  it("restores a backup when startup finds no canonical database", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-index-recover-"));
    roots.push(root);
    const path = join(root, "state.sqlite");
    const first = new IndexStore(path);
    first.initialize();
    first.insertEvent(event(7));
    first.close();
    renameSync(path, `${path}.cleanup-backup`);

    const recovered = new IndexStore(path);
    recovered.initialize();
    assert.equal(recovered.latestEventSeq(), 7);
    assert.equal(existsSync(`${path}.cleanup-backup`), false);
    recovered.close();
  });
});
