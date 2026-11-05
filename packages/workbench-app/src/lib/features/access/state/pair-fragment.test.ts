import assert from "node:assert/strict";
import test from "node:test";
import {
  consumePairFragment,
  fragmentWithoutPair,
  normalizePairingCode,
  parsePairFragment,
} from "./pair-fragment";

test("normalizes typed codes", () => {
  assert.equal(normalizePairingCode(" abcd efgh "), "ABCD-EFGH");
  assert.equal(normalizePairingCode("abcd-efgh"), "ABCD-EFGH");
  assert.equal(normalizePairingCode("abc"), undefined);
  assert.equal(normalizePairingCode("abcd-efgh-ijkl"), undefined);
});

test("parses the pair fragment", () => {
  assert.equal(parsePairFragment("#pair=abcd-efgh"), "ABCD-EFGH");
  assert.equal(parsePairFragment("#pair=bad"), undefined);
  assert.equal(parsePairFragment("#other=1"), undefined);
  assert.equal(parsePairFragment(""), undefined);
});

test("keeps unrelated fragment parameters", () => {
  assert.equal(fragmentWithoutPair("#pair=ABCD-EFGH"), "");
  assert.equal(fragmentWithoutPair("#a=1&pair=ABCD-EFGH"), "#a=1");
  assert.equal(fragmentWithoutPair("#a=1"), "#a=1");
});

test("consuming the fragment clears it from history and returns the code", () => {
  const calls: unknown[][] = [];
  const history = {
    replaceState: (...args: unknown[]) => void calls.push(args),
  };
  const code = consumePairFragment(
    { pathname: "/", search: "?x=1", hash: "#pair=abcd-efgh" },
    history,
  );
  assert.equal(code, "ABCD-EFGH");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![2], "/?x=1");
});

test("leaves history alone without a pairing fragment", () => {
  let called = false;
  const code = consumePairFragment(
    { pathname: "/", search: "", hash: "#section" },
    { replaceState: () => void (called = true) },
  );
  assert.equal(code, undefined);
  assert.equal(called, false);
});
