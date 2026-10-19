import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  completionUsageId,
  rankCompletionCandidates,
} from "../../../src/domains/completions/completion-ranking-policy.js";
import {
  adversarialJudgments,
  adversarialPaths,
  policyJudgments,
} from "../../benchmarks/completion-adversarial-judgments.js";
import { CompletionUsageStore } from "../../../src/domains/completions/completion-usage-store.js";
import { FileCompletionService } from "../../../src/domains/completions/file-completion-service.js";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";
import {
  completionJudgments,
  rankingMetrics,
} from "../../benchmarks/completion-judgments.js";

test("judged corpus includes all intent categories and metrics count misses", () => {
  assert.equal(completionJudgments.length, 56);
  assert.equal(
    new Set(completionJudgments.map((item) => item.category)).size,
    5,
  );
  assert.deepEqual(rankingMetrics([1, 2, 3, 0]), {
    count: 4,
    top1: 0.25,
    top3: 0.75,
    mrr: (1 + 0.5 + 1 / 3) / 4,
  });
});

test("policy uses explicit context and bounded decayed usage without changing highlights", () => {
  const items = [
    {
      label: "@a.ts",
      info: "a.ts",
      kind: "file" as const,
      sortScore: 1000,
      matchRanges: [[1, 2] as [number, number]],
    },
    { label: "@b.ts", info: "b.ts", kind: "file" as const, sortScore: 900 },
  ];
  assert.equal(rankCompletionCandidates(items)[0]?.label, "@a.ts");
  const ranked = rankCompletionCandidates(items, { editedPaths: ["b.ts"] });
  assert.equal(ranked[0]?.label, "@b.ts");
  assert.equal(ranked[0]?.sortScore, 2500);
  assert.deepEqual(ranked[1]?.matchRanges, [[1, 2]]);
  assert.equal(items[1]?.sortScore, 900);
  assert.equal(
    rankCompletionCandidates(
      items,
      {},
      new Map([[completionUsageId("file", "@b.ts"), 100]]),
    )[0]?.label,
    "@b.ts",
  );
  assert.equal(
    rankCompletionCandidates(
      items,
      {},
      new Map([[completionUsageId("file", "@b.ts"), NaN]]),
    )[0]?.label,
    "@a.ts",
  );
});

test("adversarial judgments exercise ambiguity, cross-kind IDs, and out-of-eight rescue", () => {
  assert.equal(adversarialJudgments.length, 19);
  assert.ok(
    adversarialPaths.filter((path) => path.endsWith("/session.ts")).length >=
      10,
  );
  let clippedMisses = 0;
  for (const judgment of policyJudgments) {
    const usage = new Map(
      judgment.usage?.map((entry) => [
        completionUsageId(entry.kind, entry.id),
        entry.count,
      ]),
    );
    const ranked = rankCompletionCandidates(
      judgment.pool,
      judgment.context,
      usage,
    );
    assert.equal(
      `${ranked[0]?.kind}:${ranked[0]?.documentId}`,
      judgment.expectedId,
      judgment.name,
    );
    const clipped = rankCompletionCandidates(
      judgment.pool.slice(0, 8),
      judgment.context,
      usage,
    );
    if (
      !clipped.some(
        (item) => `${item.kind}:${item.documentId}` === judgment.expectedId,
      )
    )
      clippedMisses++;
  }
  assert.equal(
    clippedMisses,
    3,
    "fixture must catch premature top-eight retrieval",
  );
  assert.notEqual(
    completionUsageId("file", "same"),
    completionUsageId("launch", "same"),
  );
  assert.notEqual(completionUsageId("a:b", "c"), completionUsageId("a", "b:c"));
});

test("usage is project scoped, serial, persisted, decayed, and corrupt-safe", async () => {
  const home = await mkdtemp(join(tmpdir(), "completion-usage-"));
  let now = 1000;
  try {
    const store = new CompletionUsageStore(home, () => now);
    await Promise.all([
      store.record("p", "@a.ts"),
      store.record("p", "@a.ts"),
      store.record("q", "@b.ts"),
    ]);
    assert.equal((await store.scores("p")).get("@a.ts"), 2);
    assert.equal((await store.scores("p")).has("@b.ts"), false);
    now += 30 * 24 * 60 * 60 * 1000;
    assert.equal(
      (await new CompletionUsageStore(home, () => now).scores("p")).get(
        "@a.ts",
      ),
      1,
    );
    const path = join(home, "cache", "completion-usage.json");
    await writeFile(path, "{bad json");
    assert.equal((await new CompletionUsageStore(home).scores("p")).size, 0);
    await writeFile(path, "x".repeat(256 * 1024 + 1));
    assert.equal((await new CompletionUsageStore(home).scores("p")).size, 0);
    await store.record("p", "x".repeat(2049));
    assert.ok(
      (await readFile(path)).length > 256 * 1024,
      "invalid IDs do not write",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("usage prunes count on write; unavailable home never breaks selection", async () => {
  const home = await mkdtemp(join(tmpdir(), "completion-usage-"));
  try {
    await mkdir(join(home, "cache"));
    await writeFile(
      join(home, "cache", "completion-usage.json"),
      JSON.stringify({
        version: 1,
        entries: Array.from({ length: 1000 }, (_, i) => ({
          projectId: "p",
          id: `id-${i}`,
          count: 1,
          lastUsed: 1,
        })),
      }),
    );
    const store = new CompletionUsageStore(home, () => 2);
    await store.record("p", "new");
    assert.equal((await store.scores("p")).size, 1000);
    assert.equal((await store.scores("p")).has("new"), true);
    await writeFile(join(home, "blocked"), "file");
    await new CompletionUsageStore(join(home, "blocked")).record("p", "new");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("usage enforces the encoded byte cap independently of count and preserves the new Unicode/escaped selection", async () => {
  const home = await mkdtemp(join(tmpdir(), "completion-usage-bytes-"));
  const cap = 256 * 1024;
  try {
    const entries: {
      projectId: string;
      id: string;
      count: number;
      lastUsed: number;
    }[] = [];
    let bytes = Buffer.byteLength(JSON.stringify({ version: 1, entries: [] }));
    for (let i = 0; i < 900; i++) {
      const entry = {
        projectId: "p",
        id: `old-${i}-${'界"\\\n'.repeat(80)}`,
        count: 1,
        lastUsed: 1,
      };
      const additional =
        Buffer.byteLength(JSON.stringify(entry)) + (entries.length ? 1 : 0);
      if (bytes + additional > cap - 64) break;
      entries.push(entry);
      bytes += additional;
    }
    const initial = JSON.stringify({ version: 1, entries });
    assert.equal(Buffer.byteLength(initial), bytes);
    assert.ok(bytes > cap - 1024 && bytes < cap);
    assert.ok(
      entries.length < 900,
      "fixture cannot trigger the 1,000-entry cap",
    );
    const path = join(home, "cache", "completion-usage.json");
    await mkdir(join(home, "cache"));
    await writeFile(path, initial);
    const store = new CompletionUsageStore(home, () => 2);
    assert.equal((await store.scores("p")).size, entries.length);
    const selected = `new-${'界"\\\n'.repeat(350)}`;
    assert.ok(selected.length <= 2048);
    await store.record("p", selected);
    const output = await readFile(path);
    assert.ok(output.byteLength <= cap);
    const saved = JSON.parse(output.toString()) as {
      entries: { id: string }[];
    };
    assert.ok(
      saved.entries.length < entries.length + 1,
      "encoded bytes, not count, must actually prune old data",
    );
    assert.ok(saved.entries.some((entry) => entry.id === selected));
    assert.equal(
      (await new CompletionUsageStore(home, () => 2).scores("p")).has(selected),
      true,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("opaque traversal-looking usage IDs never choose a filesystem path", async () => {
  const root = await mkdtemp(join(tmpdir(), "completion-usage-opaque-"));
  const home = join(root, "homes", "slot", "data");
  try {
    await mkdir(join(root, "homes"), { recursive: true });
    const sibling = join(root, "homes", "opaque.json");
    await writeFile(sibling, "sentinel");
    const store = new CompletionUsageStore(home, () => 1);
    await store.record("p", "../../opaque.json");
    assert.equal(await readFile(sibling, "utf8"), "sentinel");
    const persisted = await readFile(
      join(home, "cache", "completion-usage.json"),
      "utf8",
    );
    assert.ok(persisted.includes("../../opaque.json"));
    assert.equal(
      (await new CompletionUsageStore(home, () => 1).scores("p")).has(
        "../../opaque.json",
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("service rescues a contextual candidate outside lexical top eight before display truncation", async () => {
  let nativeLimit = 0;
  const service = new FileCompletionService(
    () => ({
      id: "p",
      name: "p",
      directory: "/synthetic",
      createdAt: "",
      updatedAt: "",
    }),
    {
      discover: async () =>
        Array.from({ length: 16 }, (_, i) =>
          candidateFromPath(`duplicate-${i}/session.ts`, "file"),
        ),
      createIndex: async () => ({
        async query(_query, options) {
          nativeLimit = options?.limit ?? 0;
          return Array.from({ length: Math.min(nativeLimit, 16) }, (_, i) => ({
            candidateIndex: i,
            score: 1000 - i * 10,
            matchRanges: [],
          }));
        },
        async close() {},
      }),
    },
  );
  try {
    const result = await service.completeFiles("p", "ts", {
      limit: 1,
      context: { editedPaths: ["duplicate-11/session.ts"] },
    });
    assert.equal(nativeLimit, 64);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.label, "@duplicate-11/session.ts");
  } finally {
    await service.dispose();
  }
});

test("unavailable items sort last even when frequently used and empty queries sort by usage across kinds", () => {
  const items = [
    { kind: "file" as const, label: "file", sortScore: 90000 },
    { kind: "tool" as const, label: "tool", sortScore: 0 },
    {
      kind: "skill" as const,
      label: "blocked",
      available: false,
      sortScore: 100000,
    },
  ];
  const usage = new Map([
    [completionUsageId("tool", "tool"), 2],
    [completionUsageId("skill", "blocked"), 100],
  ]);
  assert.deepEqual(
    rankCompletionCandidates(items, {}, usage, { emptyQuery: true }).map(
      (item) => item.label,
    ),
    ["tool", "file", "blocked"],
  );
});
