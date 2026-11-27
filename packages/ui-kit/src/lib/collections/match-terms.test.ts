import assert from "node:assert/strict";
import test from "node:test";
import { matchesTerms, searchTerms } from "./match-terms.js";

test("splits a query on any whitespace and lower-cases it", () => {
  assert.deepEqual(searchTerms("  Foo\tbar \n BAZ "), ["foo", "bar", "baz"]);
  assert.deepEqual(searchTerms("   "), []);
});

test("every term must appear in some field", () => {
  assert.equal(matchesTerms("", "anything"), true);
  assert.equal(matchesTerms("foo bar", "Bar of foo"), true);
  assert.equal(matchesTerms("foo bar", "foo", "BAR"), true);
  assert.equal(matchesTerms("foo bar", "foo"), false);
  assert.equal(matchesTerms("foo", undefined, null, "xfoox"), true);
});

test("a term does not match across two fields", () => {
  assert.equal(matchesTerms("ab", "a", "b"), false);
});
