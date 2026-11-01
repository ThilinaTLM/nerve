import assert from "node:assert/strict";
import { test } from "node:test";

import { findQuoteLines } from "./composer-quote-blocks.js";

test("finds blockquote lines and nested markers", () => {
  assert.deepEqual(findQuoteLines("Intro\n> one\n>\n> > nested\nafter"), [
    { line: 2, markerLength: 2 },
    { line: 3, markerLength: 1 },
    { line: 4, markerLength: 4 },
  ]);
});

test("ignores quote markers inside fenced code", () => {
  assert.deepEqual(findQuoteLines("```sh\n> not a quote\n```\n> quote"), [
    { line: 4, markerLength: 2 },
  ]);
});
