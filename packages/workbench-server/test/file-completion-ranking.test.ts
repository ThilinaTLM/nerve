import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FILE_COMPLETION_RESULT_LIMIT } from "@nervekit/contracts";
import { candidateFromPath } from "../src/domains/completions/file-completion-candidates.js";
import {
  completeFileCandidates,
  isUnsafeCompletionQuery,
} from "../src/domains/completions/file-completion-ranking.js";

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
