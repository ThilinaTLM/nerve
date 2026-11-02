import assert from "node:assert/strict";
import { test } from "node:test";
import { builtinPromptSuggestionDefinitions } from "./prompt-suggestion-builtins.js";
import { evaluatePromptSuggestions } from "./prompt-suggestion-evaluator.js";
import type {
  PromptSuggestionEvaluationInput,
  PromptSuggestionRepo,
} from "./prompt-suggestion-types.js";

const clean: PromptSuggestionRepo = {
  relativePath: ".",
  absDir: "/p",
  name: "p",
  isRepo: true,
  currentBranch: "feature/x",
  detached: false,
  ahead: 0,
  behind: 0,
  hasUpstream: true,
  unpublishedCount: null,
  hasStashes: false,
  hasRemote: true,
  hasGithubRemote: true,
  baseBranch: "main",
  onBaseBranch: false,
  mergedToBase: false,
  dirty: false,
  changeCount: 0,
  pullRequest: null,
};
const pr = {
  number: 7,
  url: "https://github.com/o/r/pull/7",
  isDraft: false,
  checks: "passing" as const,
  reviewRequested: false,
};

function names(
  repos: PromptSuggestionRepo[],
  options: {
    github?: boolean;
    status?: "idle" | "failed";
  } = {},
): string[] {
  const input: PromptSuggestionEvaluationInput = {
    project: { id: "proj_t", name: "t", dir: "/p" },
    conversation: {
      id: "conv_t",
      title: "t",
      permissionRuleSetId: "default",
      reasoningLevel: "medium",
      status: options.status ?? "idle",
    },
    git: {
      projectIsRepo: true,
      repos,
      github: {
        available: options.github ?? true,
        authenticated: options.github ?? true,
      },
    },
    definitions: builtinPromptSuggestionDefinitions().map((d) => ({
      ...d,
      enabled: true,
    })),
  };
  return evaluatePromptSuggestions(input, []).suggestions.map((s) => s.name);
}

void test("builtins: every default-off entry is declared and bodies are plain text", () => {
  const defs = builtinPromptSuggestionDefinitions();
  assert.deepEqual(
    defs.filter((d) => !d.defaultEnabled).map((d) => d.name),
    ["review-changes", "cleanup-merged-branch", "continue-after-failure"],
  );
  assert.equal(defs.length, 10);
  for (const def of defs) {
    assert.ok(def.conditionSummary, def.name);
    assert.ok(!/suggested/i.test(def.promptPreview ?? ""), def.name);
    assert.ok(!def.promptPreview?.includes("```"), def.name);
    // State goes last, as one "Last known state" line for a single root repo.
    const lines = (def.promptPreview ?? "").split("\n");
    assert.match(
      lines.at(-1) ?? "",
      /^Last known state: `[^`]+`.*\.$/,
      def.name,
    );
    assert.equal(def.enabled, def.defaultEnabled);
  }
});

void test("builtins: commit and ship chips are mutually exclusive per repo", () => {
  const ship = (r: Partial<PromptSuggestionRepo>, github = true) =>
    names([{ ...clean, ...r }], { github }).filter((n) =>
      [
        "commit-changes",
        "commit-on-feature-branch",
        "create-pull-request",
        "update-pull-request",
        "push-commits",
      ].includes(n),
    );

  assert.deepEqual(ship({ dirty: true, changeCount: 2 }), [
    "commit-changes",
    "create-pull-request",
  ]);
  assert.deepEqual(
    ship({ dirty: true, changeCount: 2, pullRequest: pr, ahead: 1 }),
    ["commit-changes", "update-pull-request"],
  );
  assert.deepEqual(
    ship({
      dirty: true,
      onBaseBranch: true,
      currentBranch: "main",
      mergedToBase: true,
    }),
    ["commit-on-feature-branch", "create-pull-request"],
  );
  assert.deepEqual(
    ship({ dirty: true, onBaseBranch: true, hasRemote: false }),
    ["commit-changes"],
  );
  assert.deepEqual(ship({ pullRequest: pr, ahead: 2 }), [
    "update-pull-request",
  ]);
  assert.deepEqual(ship({ pullRequest: pr }), []);
  assert.deepEqual(ship({}), ["create-pull-request"]);
  assert.deepEqual(ship({}, false), []);
  assert.deepEqual(ship({ ahead: 3 }, false), ["push-commits"]);
  assert.deepEqual(
    ship({
      ahead: 3,
      onBaseBranch: true,
      currentBranch: "main",
      mergedToBase: true,
    }),
    ["push-commits"],
  );
});

void test("builtins: failing checks, pull, review, cleanup, continue", () => {
  assert.ok(
    names([{ ...clean, pullRequest: { ...pr, checks: "failing" } }]).includes(
      "fix-failing-checks",
    ),
  );
  assert.ok(
    !names([{ ...clean, pullRequest: pr }]).includes("fix-failing-checks"),
  );
  assert.ok(names([{ ...clean, behind: 2 }]).includes("pull-upstream"));
  assert.ok(!names([clean]).includes("pull-upstream"));
  assert.ok(names([{ ...clean, dirty: true }]).includes("review-changes"));
  assert.ok(
    !names([{ ...clean, mergedToBase: true }]).includes("review-changes"),
  );
  assert.deepEqual(names([{ ...clean, mergedToBase: true }]), [
    "cleanup-merged-branch",
  ]);
  assert.ok(
    !names([{ ...clean, mergedToBase: true, pullRequest: pr }]).includes(
      "cleanup-merged-branch",
    ),
  );
  assert.ok(
    names([clean], { status: "failed" }).includes("continue-after-failure"),
  );
  assert.ok(!names([clean]).includes("continue-after-failure"));
});

void test("builtins: labels carry counts and prompts include context without fences", () => {
  const input: PromptSuggestionEvaluationInput = {
    project: { id: "proj_t", name: "t", dir: "/p" },
    git: {
      projectIsRepo: true,
      repos: [
        { ...clean, dirty: true, changeCount: 4, pullRequest: pr, ahead: 1 },
      ],
      github: { available: true, authenticated: true },
    },
    definitions: builtinPromptSuggestionDefinitions(),
  };
  const result = evaluatePromptSuggestions(input, []);
  const byName = new Map(result.suggestions.map((s) => [s.name, s]));
  assert.equal(byName.get("commit-changes")?.label, "Commit 4 changes");
  assert.equal(byName.get("update-pull-request")?.label, "Update PR #7");
  const prompt = byName.get("update-pull-request")!.prompt;
  assert.match(prompt, /PR #7\.$/);
  for (const suggestion of result.suggestions)
    assert.ok(!suggestion.prompt.includes("```"));
});

void test("builtins: state lists only relevant non-zero facts, at the end", () => {
  const repo = {
    ...clean,
    dirty: true,
    changeCount: 3,
    ahead: 2,
    pullRequest: { ...pr, checks: "failing" as const },
  };
  const defs = builtinPromptSuggestionDefinitions();
  const input = {
    project: { id: "proj_t", name: "t", dir: "/p" },
    git: {
      projectIsRepo: true,
      repos: [repo],
      github: { available: true, authenticated: true },
    },
    definitions: [],
  };
  const update = defs.find((d) => d.name === "update-pull-request")!;
  const prompt = update.buildPrompt!(input);
  assert.match(
    prompt,
    /^Update my open pull request with the latest work\.\n\n1\. /,
  );
  assert.ok(
    prompt.endsWith(
      "Last known state: `feature/x` (base `main`), 3 uncommitted changes, 2 unpushed commits, PR #7, checks failing.",
    ),
    prompt,
  );
  assert.equal(
    update.buildContext?.(input),
    "feature/x (base main) · 3 uncommitted changes · 2 unpushed commits · PR #7, checks failing",
  );
  // Commit only reports changes; zero "behind" never appears.
  const commit = defs.find((d) => d.name === "commit-changes")!;
  assert.ok(
    commit.buildPrompt!(input).endsWith(
      "Last known state: `feature/x` (base `main`), 3 uncommitted changes.",
    ),
  );
  // Several repos: a list keyed by name, and a per-repo instruction.
  const multi = {
    ...input,
    git: {
      ...input.git,
      repos: [
        { ...repo, relativePath: "api", name: "api" },
        { ...repo, relativePath: "web", name: "web", changeCount: 1 },
      ],
    },
  };
  const text = commit.buildPrompt!(multi);
  assert.match(text, /Do this in each repository listed below/);
  assert.ok(
    text.endsWith(
      "Last known state:\n- `api`: `feature/x` (base `main`), 3 uncommitted changes\n- `web`: `feature/x` (base `main`), 1 uncommitted change",
    ),
    text,
  );
});
