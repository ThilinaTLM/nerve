import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  unifiedTimelineInvariantCoverage,
  unifiedTimelineMutationInventory,
} from "./unified-timeline-coverage.js";

const proposalDirectory = fileURLToPath(
  new URL(
    "../../../../docs/proposals/unified-conversation-timeline/",
    import.meta.url,
  ),
);

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
  for (const [, phase, evidence] of unifiedTimelineInvariantCoverage) {
    assert.ok(phase >= 1 && phase <= 10);
    assert.ok(evidence.length > 0);
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
