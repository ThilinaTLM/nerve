import assert from "node:assert/strict";
import { existsSync, renameSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { IndexStore } from "../src/infrastructure/index-store/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

const trust = (trustId: string) => ({
  trustId,
  sourceKind: "project" as const,
  path: "/tmp/project",
  name: trustId,
  label: trustId,
  predicateHash: `hash_${trustId}`,
  status: "allowed" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("IndexStore fresh replacement", () => {
  it("can roll back or commit while keeping the same facade", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-index-replace-"));
    roots.push(root);
    const path = join(root, "state.sqlite");
    const index = new IndexStore(path);
    index.initialize();
    index.upsertPromptSuggestionTrust(trust("one"));

    const rollback = index.beginFreshReplacement();
    assert.equal(index.listPromptSuggestionTrust().length, 0);
    index.upsertPromptSuggestionTrust(trust("two"));
    index.rollbackFreshReplacement(rollback);
    assert.deepEqual(
      index.listPromptSuggestionTrust().map(({ trustId }) => trustId),
      ["one"],
    );

    const commit = index.beginFreshReplacement();
    index.upsertPromptSuggestionTrust(trust("three"));
    index.commitFreshReplacement(commit);
    assert.deepEqual(
      index.listPromptSuggestionTrust().map(({ trustId }) => trustId),
      ["three"],
    );
    assert.equal(existsSync(`${path}.cleanup-backup`), false);
    index.close();
  });

  it("restores a backup when startup finds no canonical database", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-index-recover-"));
    roots.push(root);
    const path = join(root, "state.sqlite");
    const first = new IndexStore(path);
    first.initialize();
    first.upsertPromptSuggestionTrust(trust("seven"));
    first.close();
    renameSync(path, `${path}.cleanup-backup`);

    const recovered = new IndexStore(path);
    recovered.initialize();
    assert.deepEqual(
      recovered.listPromptSuggestionTrust().map(({ trustId }) => trustId),
      ["seven"],
    );
    assert.equal(existsSync(`${path}.cleanup-backup`), false);
    recovered.close();
  });
});
