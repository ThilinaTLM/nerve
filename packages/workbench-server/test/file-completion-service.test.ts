import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  completeFileCandidates,
  discoverCandidates,
  type FileCompletionCandidate,
} from "../src/domains/completions/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function candidate(
  relativePath: string,
  kind: "file" | "directory" = "file",
): FileCompletionCandidate {
  const segments = relativePath.split("/");
  const name = segments[segments.length - 1] ?? relativePath;
  return {
    relativePath,
    name,
    parentPath: segments.slice(0, -1).join("/"),
    depth: segments.length,
    kind,
  };
}

function labelsFor(query: string, candidates: FileCompletionCandidate[]) {
  return completeFileCandidates(candidates, query, { limit: 20 }).map(
    (item) => item.label,
  );
}

describe("file completion service", () => {
  it("fuzzy matches basename acronyms", () => {
    const labels = labelsFor("cmcomp", [
      candidate(
        "packages/workbench-app/src/lib/features/conversations/components/CodeMirrorComposer.svelte",
      ),
      candidate(
        "packages/workbench-app/src/lib/features/conversations/components/ComposerToolbar.svelte",
      ),
      candidate("packages/workbench-server/src/routes/completion-routes.ts"),
    ]);

    assert.equal(
      labels[0],
      "@packages/workbench-app/src/lib/features/conversations/components/CodeMirrorComposer.svelte",
    );
  });

  it("matches multiple path terms across segments and basename", () => {
    const labels = labelsFor("src composer", [
      candidate("docs/composer-notes.md"),
      candidate(
        "src/lib/features/conversations/components/CodeMirrorComposer.svelte",
      ),
      candidate("src/routes/completion-routes.ts"),
    ]);

    assert.equal(
      labels[0],
      "@src/lib/features/conversations/components/CodeMirrorComposer.svelte",
    );
  });

  it("boosts direct descendants for path-scoped folder queries", () => {
    const labels = labelsFor("src/lib/", [
      candidate("src", "directory"),
      candidate("src/lib", "directory"),
      candidate("src/lib/components", "directory"),
      candidate("src/lib/components/Button.svelte"),
      candidate("src/lib/utils/path.ts"),
      candidate("scripts/src-lib-helper.ts"),
    ]);

    assert.deepEqual(labels.slice(0, 3), [
      "@src/lib/components/",
      "@src/lib/utils/path.ts",
      "@src/lib/components/Button.svelte",
    ]);
    assert.ok(!labels.includes("@src/lib/"));
  });

  it("returns no candidates for traversal-style queries", () => {
    assert.deepEqual(
      labelsFor("../secrets", [
        candidate("src/index.ts"),
        candidate("README.md"),
      ]),
      [],
    );
  });

  it("sorts exact and prefix basename matches ahead of weaker fuzzy matches", () => {
    const labels = labelsFor("composer", [
      candidate("src/CodeMirrorComposer.svelte"),
      candidate("src/composer.ts"),
      candidate("src/components/PromptComposer.svelte"),
    ]);

    assert.equal(labels[0], "@src/composer.ts");
  });

  it("prioritizes exact-case camel component matches for uppercase queries", () => {
    const labels = labelsFor("Composer", [
      candidate("src/styles/components/composer.css"),
      candidate("src/features/conversations/state/composer-config.svelte.ts"),
      candidate("src/features/conversations/components/ComposerToolbar.svelte"),
      candidate("src/features/conversations/components/PromptComposer.svelte"),
      candidate(
        "src/features/conversations/components/CodeMirrorComposer.svelte",
      ),
      candidate("src/components/ui/alert-dialog/alert-dialog.svelte"),
    ]);

    assert.deepEqual(labels.slice(0, 3), [
      "@src/features/conversations/components/ComposerToolbar.svelte",
      "@src/features/conversations/components/PromptComposer.svelte",
      "@src/features/conversations/components/CodeMirrorComposer.svelte",
    ]);
    assert.ok(
      !labels.includes("@src/components/ui/alert-dialog/alert-dialog.svelte"),
    );
  });

  it("fallback discovery skips noisy generated directories", async () => {
    const root = await tempRoot("nerve-completions-");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export {};\n");
    await writeFile(
      join(root, "node_modules", "pkg", "index.js"),
      "module.exports = {};\n",
    );
    await writeFile(join(root, ".git", "config"), "[core]\n");

    const candidates = await discoverCandidates(root);
    const paths = candidates.map((item) => item.relativePath);

    assert.ok(paths.includes("src"));
    assert.ok(paths.includes("src/index.ts"));
    assert.ok(!paths.some((path) => path.startsWith("node_modules")));
    assert.ok(!paths.some((path) => path.startsWith(".git")));
  });
});
