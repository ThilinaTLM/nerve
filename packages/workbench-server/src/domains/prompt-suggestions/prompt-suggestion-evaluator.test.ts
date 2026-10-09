import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePromptSuggestions } from "./prompt-suggestion-evaluator.js";
import type {
  PromptSuggestionDefinition,
  PromptSuggestionEvaluationInput,
} from "./prompt-suggestion-types.js";
import type { PromptSuggestionTrustRecord } from "./prompt-suggestion-trust.repository.js";

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
      modes: ["planning"],
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
      mode: "planning",
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
