import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FILE_COMPLETION_RESULT_LIMIT } from "@nervekit/contracts/completions";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";
import { isUnsafeCompletionQuery } from "../../../src/domains/completions/file-completion-items.js";
import { completeFileCandidates } from "../../benchmarks/file-completion-optimized.js";

import { completeFileCandidates as baseline } from "../../benchmarks/file-completion-baseline.js";
import { syntheticCompletionCandidates } from "../../benchmarks/file-completion.benchmark.js";

const files = (paths: string[]) =>
  paths.map((path) => candidateFromPath(path, "file"));

describe("file completion ranking", () => {
  it("prioritizes exact basenames and disambiguates them with folder terms", () => {
    const candidates = files([
      "packages/server/package.json",
      "packages/app/package.json",
      "docs/server-packages.md",
    ]);

    assert.equal(
      completeFileCandidates(candidates, "package")[0]?.info,
      "packages/app/package.json",
    );
    assert.equal(
      completeFileCandidates(candidates, "package server")[0]?.info,
      "packages/server/package.json",
    );
    assert.equal(
      completeFileCandidates(candidates, "server package")[0]?.info,
      "packages/server/package.json",
    );
  });

  it("treats slash terms as ordered path intent with skipped segments", () => {
    const candidates = files([
      "src/components/composer/ComposerEditor.svelte",
      "composer/generated/src.ts",
    ]);

    assert.equal(
      completeFileCandidates(candidates, "src/composer")[0]?.info,
      "src/components/composer/ComposerEditor.svelte",
    );
    assert.equal(
      completeFileCandidates(candidates, "composer/src")[0]?.info,
      "composer/generated/src.ts",
    );
  });

  it("uses distinct path segments for repeated whitespace terms", () => {
    const candidates = files(["foo/item.ts", "foo/foo/item.ts"]);
    const results = completeFileCandidates(candidates, "foo foo");

    assert.equal(results[0]?.info, "foo/foo/item.ts");
    assert.equal(
      results.some((item) => item.info === "foo/item.ts"),
      false,
    );
  });

  it("prefers compact boundary-aware fuzzy alignments and highlights them", () => {
    const candidates = files([
      "src/ComposerEditor.svelte",
      "src/c_o_m_p_o_s_e_r.txt",
      "src/client-events-dispatcher.ts",
    ]);
    const composer = completeFileCandidates(candidates, "composer");
    const initials = completeFileCandidates(candidates, "CED");

    assert.equal(composer[0]?.info, "src/ComposerEditor.svelte");
    assert.deepEqual(composer[0]?.matchRanges, [[5, 13]]);
    assert.equal(initials[0]?.info, "src/ComposerEditor.svelte");
    assert.equal((initials[0]?.matchRanges?.length ?? 0) >= 2, true);
  });

  it("is case-insensitive, stable, safe, and hard-capped", () => {
    const candidates = files(
      Array.from({ length: 20 }, (_, index) => `src/Result${index}.ts`),
    );
    const results = completeFileCandidates(candidates, "RESULT", {
      limit: 100,
    });

    assert.equal(results.length, FILE_COMPLETION_RESULT_LIMIT);
    assert.deepEqual(
      results.map((item) => item.info),
      completeFileCandidates(candidates, "RESULT", { limit: 100 }).map(
        (item) => item.info,
      ),
    );
    assert.equal(isUnsafeCompletionQuery("../secret"), true);
    assert.equal(isUnsafeCompletionQuery("C:/secret"), true);
    assert.deepEqual(completeFileCandidates(candidates, "../secret"), []);
  });
});

describe("optimized completion parity", () => {
  it("matches the frozen ranker across query intents and slice limits", () => {
    const candidates = [
      ...syntheticCompletionCandidates(250),
      ...files([
        "foo/foo/item.ts",
        "foo/item.ts",
        "src/😀résumé.ts",
        "src/İndex.ts",
        "a/b/c/d/e/f/g.ts",
      ]),
      candidateFromPath("packages", "directory"),
      candidateFromPath("packages/app", "directory"),
    ];
    const queries = [
      "",
      "@",
      " @@@packages ",
      "packages/",
      "packages/app/",
      "packages//app",
      "APP/Composer",
      "foo foo",
      "Completion server",
      "CED",
      "résumé",
      "İn",
      "😀",
      "index",
      "a b c d e f g",
      "a/b/c/d/e/f/g",
      "no-such-match",
      "../secret",
      "@..\\secret",
      "/absolute",
      "C:\\secret",
      "//network/share",
    ];
    const limits = [
      undefined,
      0,
      1,
      3,
      8,
      100,
      -1,
      -8,
      -1000,
      2.9,
      -2.9,
      NaN,
      Infinity,
      -Infinity,
    ];
    for (const query of queries) {
      for (const limit of limits) {
        assert.deepEqual(
          completeFileCandidates(candidates, query, { limit }),
          baseline(candidates, query, { limit }),
          `${JSON.stringify(query)}, limit ${limit}`,
        );
      }
    }
  });

  it("retains input order for duplicate and canonically equivalent Unicode ties", () => {
    const candidates = Array.from({ length: 24 }, (_, index) => ({
      ...candidateFromPath(
        index % 2 ? "e\u0301\u0323.ts" : "e\u0323\u0301.ts",
        "file",
      ),
      parentPath: `input-${index}`,
    }));
    assert.equal(
      candidates[0]!.relativePath.localeCompare(candidates[1]!.relativePath),
      0,
    );
    for (const query of ["", "ts"]) {
      const results = completeFileCandidates(candidates, query);
      assert.deepEqual(results, baseline(candidates, query));
      assert.deepEqual(
        results.map((item) => item.detail),
        Array.from({ length: 8 }, (_, index) => `file · input-${index}`),
      );
    }
  });

  it("keeps UTF-16 highlight offsets after supplementary characters", () => {
    const candidates = files(["😀/résumé.ts", "src/😀ComposerEditor.ts"]);
    const results = completeFileCandidates(candidates, "résumé");
    assert.deepEqual(results[0]?.matchRanges, [[4, 10]]);
    assert.equal(results[0]?.label.slice(4, 10), "résumé");
    for (const query of ["😀", "résumé", "CED", "İ", "😀/ré"]) {
      assert.deepEqual(
        completeFileCandidates(candidates, query),
        baseline(candidates, query),
      );
    }
  });
});
