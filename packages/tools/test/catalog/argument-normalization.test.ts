import assert from "node:assert/strict";
import test from "node:test";
import {
  describeToolArgumentErrors,
  normalizeToolArguments,
  requireToolDefinition,
} from "../../src/catalog/index.js";

const normalized = (name: string, args: unknown) => {
  const definition = requireToolDefinition(name);
  const value = normalizeToolArguments(definition, args);
  return { value, errors: describeToolArgumentErrors(definition, value) };
};

test("ask_user legacy single-question shape becomes questions[]", () => {
  const { value, errors } = normalized("ask_user", {
    question: "Which?",
    options: [{ label: "A" }],
  });
  assert.deepEqual(value, {
    questions: [
      { question: "Which?", options: [{ label: "A" }], id: "answer" },
    ],
  });
  assert.equal(errors, undefined);
  assert.deepEqual(
    normalizeToolArguments(requireToolDefinition("ask_user"), value),
    value,
  );
});

test("ask_user questions[] passes through unchanged", () => {
  const args = { questions: [{ question: "Which?" }] };
  assert.deepEqual(normalized("ask_user", args).value, args);
});

test("normalization does not loosen the schema (nulls stay invalid)", () => {
  assert.ok(normalized("grep", { pattern: "x", path: null }).errors);
});

test("empty edit arguments report field-level errors", () => {
  assert.match(normalized("edit", {}).errors ?? "", /missing required "path"/);
});
