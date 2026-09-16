import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  unifiedTimelineInvariantCoverage,
  unifiedTimelineMutationInventory,
} from "./unified-timeline-coverage.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const proposalDirectory = `${repositoryRoot}docs/proposals/unified-conversation-timeline/`;

const proposalFiles = [
  "timeline.md",
  "execution.md",
  "projections.md",
  "permissions.md",
  "durable-recovery.md",
  "migration.md",
  "validation.md",
];

test("INV-COVERAGE-01 maps every owning unified-timeline invariant once", () => {
  const documented = new Set<string>();
  for (const file of proposalFiles) {
    const text = readFileSync(`${proposalDirectory}${file}`, "utf8");
    for (const match of text.matchAll(/^#{3,4} (INV-[A-Z]+-\d+)$/gm)) {
      documented.add(match[1]);
    }
  }

  const mapped = unifiedTimelineInvariantCoverage.map(([id]) => id);
  assert.equal(new Set(mapped).size, mapped.length, "duplicate coverage ID");
  assert.deepEqual([...mapped].sort(), [...documented].sort());
  const soleOwners = new Map<string, string[]>();
  for (const [
    id,
    phase,
    description,
    evidence,
  ] of unifiedTimelineInvariantCoverage) {
    assert.ok(phase >= 1 && phase <= 10);
    assert.ok(description.length > 0);
    assert.ok(evidence.length > 0, `${id} has no executable evidence`);
    for (const item of evidence) {
      assert.match(item.file, /\.test\.(?:ts|mjs)$/);
      assert.doesNotMatch(item.file, /legacy-journal|retired|deleted/);
      const text = readFileSync(`${repositoryRoot}${item.file}`, "utf8");
      assert.ok(
        text.includes(item.testId),
        `${id} references missing test '${item.testId}' in ${item.file}`,
      );
      const key = `${item.file}\0${item.testId}`;
      soleOwners.set(key, [...(soleOwners.get(key) ?? []), id]);
    }
  }
  for (const [key, owners] of soleOwners) {
    if (owners.length < 2) continue;
    const relatedOwnerSets = [
      ["INV-PAGE-01", "INV-VIEW-01"],
      ["INV-CLAIM-01", "INV-EFFECT-01"],
      ["INV-DELETE-01", "INV-DELIVERY-01"],
    ];
    assert.ok(
      relatedOwnerSets.some(
        (allowed) =>
          JSON.stringify([...owners].sort()) === JSON.stringify(allowed),
      ),
      `unrelated invariants share sole evidence ${key}`,
    );
  }
});

test("INV-AUTH-01 inventories each mutation with exactly one owner", () => {
  const mutations = unifiedTimelineMutationInventory.map(
    ([mutation]) => mutation,
  );
  assert.equal(new Set(mutations).size, mutations.length);
  for (const [mutation, owner] of unifiedTimelineMutationInventory) {
    assert.ok(mutation.length > 0);
    assert.ok(owner.length > 0);
  }
});
