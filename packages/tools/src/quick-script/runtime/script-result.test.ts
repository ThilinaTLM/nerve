import assert from "node:assert/strict";
import { test } from "node:test";
import { resultExpressions } from "./script-result.js";

/** The most likely rewrite, or the script itself when its last statement is not an expression. */
const resultExpression = (code: string) => resultExpressions(code)[0] ?? code;

const same = (code: string) => assert.equal(resultExpression(code), code);

void test("the last expression statement is returned, on its own line", () => {
  assert.equal(
    resultExpression(`jira.issues.get("X")`),
    `return (jira.issues.get("X"))`,
  );
  assert.equal(
    resultExpression(`const r = await a();\nr.map((x) => x.key); // keys\n`),
    `const r = await a();\nreturn (r.map((x) => x.key)); // keys\n`,
  );
  assert.equal(
    resultExpression("await a()\nfoo\n  .bar()\n  .baz()"),
    "await a()\nreturn (foo\n  .bar()\n  .baz())",
  );
  assert.equal(
    resultExpression("for (const x of xs) { await f(x); }\nresults"),
    "for (const x of xs) { await f(x); }\nreturn (results)",
  );
  assert.equal(
    resultExpression("const s = `a;${b}\n`;\ntype.id"),
    "const s = `a;${b}\n`;\nreturn (type.id)",
  );
});

void test("statements that are not expressions stay as written", () => {
  same("const r = await a();");
  same("a();\nfor (const x of xs) f(x)");
  same("a();\nif (x) b(); else c()");
  same("a();\n{ b() }");
  same("a();\nreturn b");
  same("a();\nasync function f() {}");
  same("a();\nouter: b()");
  same("a(");
});

void test("a line break that may not end a statement is not a boundary", () => {
  // The body of a braceless loop or branch must not become a return.
  same("while (more())\n  step()");
  same("for (const x of xs)\n  await f(x)");
  same("if (a)\n  b()\nelse\n  c()");
  same("do\n  step()\nwhile (more())");
  // A continued expression is returned whole.
  assert.equal(
    resultExpression("a();\nfoo\n(bar)"),
    "a();\nreturn (foo\n(bar))",
  );
  assert.equal(resultExpression("a();\nx =\n  y"), "a();\nreturn (x =\n  y)");
});

void test("a slash after a closing bracket reads as a division first, then as a regular expression", () => {
  assert.deepEqual(resultExpressions("(4) / 2"), ["return ((4) / 2)"]);
  assert.deepEqual(
    resultExpressions("const t0 = 1;\n({ secs: (Date.now() - t0) / 1000 })"),
    ["const t0 = 1;\nreturn (({ secs: (Date.now() - t0) / 1000 }))"],
  );
  // Read as a regular expression the script has no last expression; the division reading stands alone.
  assert.deepEqual(resultExpressions('const a = (4) / 2;\n"after"'), [
    'const a = (4) / 2;\nreturn ("after")',
  ]);
  // The readings differ: both are offered and the caller takes the first that compiles.
  assert.equal(resultExpressions("a();\nf(x) / 2; g() / 3").length, 2);
  assert.equal(
    resultExpression("a();\n/re/.test(s)"),
    "a();\nreturn (/re/.test(s))",
  );
});

void test("a parenthesized expression after a block statement is a statement of its own", () => {
  for (const block of [
    "for (const k of [1]) { }",
    "if (true) { }",
    "if (a) { } else { }",
    "try { a() } catch { }",
    "function f() {}",
    "async function f() {}",
  ])
    assert.equal(
      resultExpression(`${block}\n(1 + 1)`),
      `${block}\nreturn ((1 + 1))`,
    );
  // After an expression that ends in a brace it is a call, so nothing is split there.
  assert.equal(
    resultExpression("const f = function () {}\n(1 + 1)"),
    "const f = function () {}\n(1 + 1)",
  );
});

void test("a closing bracket does not start a statement", () => {
  same("a();\ntry { await x(); } catch (e) { console.log(e.message); }\n");
  same("a();\nfor (const x of xs) { f(x); }");
  assert.equal(
    resultExpression("a();\nb({ c: 1 });"),
    "a();\nreturn (b({ c: 1 }));",
  );
});
