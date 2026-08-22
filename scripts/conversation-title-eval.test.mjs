import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  collectConversationCases,
  compareDataset,
  evaluationInternals,
  prepareDataset,
  reportDataset,
} from "./lib/conversation-title-eval.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixtureHome() {
  const home = await mkdtemp(join(tmpdir(), "nerve-title-eval-"));
  roots.push(home);
  await mkdir(join(home, "conversations"));
  return home;
}

async function writeConversation(home, id, title, entries) {
  const root = join(home, "conversations", id);
  await mkdir(root);
  await writeFile(
    join(root, "conversation.json"),
    `${JSON.stringify({ id, title })}\n`,
  );
  await writeFile(
    join(root, "entries.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}

describe("conversation title evaluation", () => {
  it("collects the earliest user prompt, hashes IDs, and groups duplicates", async () => {
    const home = await fixtureHome();
    await writeConversation(home, "conv_private_a", "Recorded A", [
      {
        role: "user",
        text: "Later prompt",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      { role: "assistant", text: "Ignored" },
      {
        role: "user",
        text: "First   prompt",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await writeConversation(home, "conv_private_b", "Recorded B", [
      { role: "user", text: "First prompt" },
    ]);
    await writeConversation(home, "conv_no_user", "No user", [
      { role: "assistant", text: "Ignored" },
    ]);
    await mkdir(join(home, "conversations", "conv_missing"));

    const result = await collectConversationCases({
      home,
      generateTitle: (prompt) => `Generated: ${prompt}`,
    });

    assert.equal(result.cases.length, 2);
    assert.equal(result.cases[0].prompt, "First   prompt");
    assert.equal(result.cases[0].baselineTitle, "Generated: First   prompt");
    assert.equal(result.cases[0].duplicateGroupSize, 2);
    assert.equal(result.cases[1].duplicateGroupSize, 2);
    assert.equal(JSON.stringify(result.cases).includes("conv_private"), false);
    assert.match(result.cases[0].id, /^[a-f0-9]{64}$/u);
    assert.equal(result.skipped.noUserEntry, 1);
    assert.equal(result.skipped.missingRecord, 1);
  });

  it("writes a private stable dataset and refuses accidental overwrite", async () => {
    const home = await fixtureHome();
    await writeConversation(home, "conv_one", "Recorded", [
      { role: "user", text: "Add search" },
    ]);
    const output = join(home, "output");
    const manifest = await prepareDataset({
      home,
      output,
      generateTitle: () => "Add search",
      revision: "abc123",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(manifest.counts.cases, 1);
    assert.equal(manifest.baselineRevision, "abc123");
    assert.equal((await stat(output)).mode & 0o777, 0o700);
    assert.equal((await stat(join(output, "cases.jsonl"))).mode & 0o777, 0o600);
    await assert.rejects(
      prepareDataset({
        home,
        output,
        generateTitle: () => "Other",
        revision: "def456",
      }),
      /Output already exists/u,
    );
  });

  it("creates deterministic blind comparisons and reports preferences", async () => {
    const home = await fixtureHome();
    await writeConversation(home, "conv_one", "Recorded", [
      { role: "user", text: "Please add search." },
    ]);
    const output = join(home, "output");
    await prepareDataset({
      home,
      output,
      generateTitle: () => "Baseline search title",
      revision: "abc123",
    });
    const summary = await compareDataset({
      dataset: output,
      generateTitle: () => "Add search",
    });
    assert.equal(summary.allUniquePrompts.cases, 1);
    assert.equal(summary.allUniquePrompts.changed, 1);
    assert.equal(summary.allUniquePrompts.over80, 0);

    const reviewPath = join(output, "review.jsonl");
    const review = JSON.parse((await readFile(reviewPath, "utf8")).trim());
    const candidateSide =
      evaluationInternals.stableSide(review.id) === "A" ? "B" : "A";
    review.preference = candidateSide;
    await writeFile(reviewPath, `${JSON.stringify(review)}\n`);

    const report = await reportDataset({ dataset: output });
    assert.equal(report.coverage, 1);
    assert.equal(report.all.candidateWins, 1);
    assert.equal(report.all.baselineWins, 0);
    assert.equal(report.all.decisiveCandidateWinRate, 1);
    assert.ok(report.all.decisiveCandidateWinWilson95.low > 0);
  });

  it("uses stable tune splits and A/B assignments", () => {
    const id = evaluationInternals.hash("conv_stable");
    assert.equal(
      evaluationInternals.stableSplit(id),
      evaluationInternals.stableSplit(id),
    );
    assert.equal(
      evaluationInternals.stableSide(id),
      evaluationInternals.stableSide(id),
    );
  });
});
