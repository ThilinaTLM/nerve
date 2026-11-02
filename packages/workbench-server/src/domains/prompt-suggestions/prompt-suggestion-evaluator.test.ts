import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePromptSuggestions } from "./prompt-suggestion-evaluator.js";
import type {
  PromptSuggestionDefinition,
  PromptSuggestionEvaluationInput,
} from "./prompt-suggestion-types.js";
import type { PromptSuggestionTrustRecord } from "./prompt-suggestion-trust.repository.js";

void test("when: ahead/behind/base/pull-request fields and JS context expose pullRequest", () => {
  const repo = {
    relativePath: ".",
    absDir: "/p",
    name: "p",
    isRepo: true as const,
    currentBranch: "feature/x",
    detached: false,
    ahead: 2,
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
    pullRequest: {
      number: 9,
      url: "https://example.test/9",
      isDraft: false,
      checks: "failing" as const,
      reviewRequested: false,
    },
  };
  const base: PromptSuggestionDefinition = {
    id: "s",
    definitionKey: "user:s",
    name: "s",
    label: "S",
    prompt: "p",
    order: 1,
    defaultEnabled: true,
    enabled: true,
    source: { kind: "user", path: "/s.md" },
  };
  const count = (
    when: PromptSuggestionDefinition["when"],
    patch: Partial<typeof repo> = {},
  ) =>
    evaluatePromptSuggestions(
      {
        project: { id: "proj_t", name: "t", dir: "/p" },
        git: { projectIsRepo: true, repos: [{ ...repo, ...patch }] },
        definitions: [{ ...base, when }],
      },
      [],
    ).suggestions.length;
  assert.equal(count({ gitAhead: true }), 1);
  assert.equal(count({ gitAhead: false }), 0);
  assert.equal(count({ gitBehind: true }), 0);
  assert.equal(count({ gitBehind: true }, { behind: 1 }), 1);
  assert.equal(count({ onBaseBranch: false }), 1);
  assert.equal(count({ onBaseBranch: true }), 0);
  assert.equal(count({ hasPullRequest: true }), 1);
  assert.equal(
    count({ hasPullRequest: true }, { pullRequest: null as never }),
    0,
  );
  assert.equal(
    count({ hasPullRequest: false }, { pullRequest: undefined as never }),
    1,
  );

  const js = evaluatePromptSuggestions(
    {
      project: { id: "proj_t", name: "t", dir: "/p" },
      git: { projectIsRepo: true, repos: [repo] },
      definitions: [
        {
          ...base,
          enableJs:
            'function enable(c) { const r = c.git.repos[0]; return r.ahead === 2 && r.pullRequest.number === 9 && r.pullRequest.checks === "failing"; }',
          predicateHash: "h",
          trustId: "t",
        },
      ],
    },
    [
      {
        trustId: "t",
        sourceKind: "user",
        path: "/s.md",
        name: "s",
        label: "S",
        predicateHash: "h",
        status: "allowed",
      },
    ],
  );
  assert.equal(js.suggestions.length, 1);
  assert.match(js.statuses[0].conditionSummary ?? "", /custom JavaScript/);
  assert.equal(js.statuses[0].promptPreview, "p");
});

void test("evaluates conversation/rule-set conditions and fails closed for untrusted or failing predicates", () => {
  const definition: PromptSuggestionDefinition = {
    id: "suggestion",
    definitionKey: "user:test",
    name: "test",
    label: "Test",
    prompt: "Do something",
    order: 1,
    defaultEnabled: true,
    enabled: true,
    source: { kind: "user", path: "/suggestions/test.md" },
    when: {
      hasRepos: false,
      permissionRuleSets: ["read_only"],
    },
    enableJs:
      'function enable(context) { return typeof context.timestamp === "string" && context.conversation.permissionRuleSetId === "read_only" && context.conversation.reasoningLevel === "medium" && context.conversation.status === "idle" && !("agent" in context); }',
    predicateHash: "digest",
    trustId: "trust",
  };
  const input: PromptSuggestionEvaluationInput = {
    project: { id: "proj_test", name: "Test", dir: "/project" },
    conversation: {
      id: "conv_test",
      title: "Test",
      permissionRuleSetId: "read_only",
      reasoningLevel: "medium",
      status: "idle",
    },
    git: { projectIsRepo: false, repos: [] },
    definitions: [definition],
  };
  const trust: PromptSuggestionTrustRecord = {
    trustId: "trust",
    sourceKind: "user",
    path: definition.source.path,
    name: "test",
    label: "Test",
    predicateHash: "digest",
    status: "allowed",
  };
  const evaluate = (records = [trust]) =>
    evaluatePromptSuggestions(input, records);
  assert.equal(evaluate([]).suggestions.length, 0);
  assert.equal(evaluate([]).trustRequests.length, 1);
  assert.equal(
    evaluate([{ ...trust, status: "denied" }]).suggestions.length,
    0,
  );
  assert.equal(
    evaluate([{ ...trust, predicateHash: "changed" }]).suggestions.length,
    0,
  );
  assert.equal(evaluate().suggestions.length, 1);
  input.conversation!.permissionRuleSetId = "full_access";
  assert.equal(evaluate().suggestions.length, 0);
  input.conversation!.permissionRuleSetId = "read_only";
  definition.enabled = false;
  assert.equal(evaluate().suggestions.length, 0);
  definition.enabled = true;
  for (const code of [
    'function enable() { return "true"; }',
    'function enable() { throw new Error("no"); }',
    "function enable() { while (true) {} }",
    'function enable() { return eval("true"); }',
  ]) {
    definition.enableJs = code;
    const result = evaluate();
    assert.equal(result.suggestions.length, 0);
    if (!code.includes('return "true"'))
      assert.equal(result.diagnostics[0]?.code, "enable_failed");
  }
});
