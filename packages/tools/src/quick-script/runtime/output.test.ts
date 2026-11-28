import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PRINT_CELL_CHARS,
  PRINT_ROWS,
  PRINT_STRING_CHARS,
  PRINT_VALUE_CHARS,
} from "../limits.js";
import { createQuickScriptRegistry } from "../registry.js";
import { executeQuickScript } from "./quick-script.js";

const registry = createQuickScriptRegistry([]);

async function run(code: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "quick-script-output-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const result = await executeQuickScript(
    { code },
    { registry, cwd, authorizeNested: async () => undefined },
  );
  return result.content ?? "";
}

void test("console.log and the result share one compact format", async () => {
  assert.equal(
    await run(
      `console.log({ a: 1, b: { c: [1, 2] } }, "text", null, undefined, new Map([["k", 2]]), new Set([1]), new Date(0), new Error("x"), 5n)`,
    ),
    '{"a":1,"b":{"c":[1,2]}} text null undefined {"k":2} [1] 1970-01-01T00:00:00.000Z Error: x 5n',
  );
  // Flat rows are a table, as a console.log argument and as the result.
  const table = "k | n\nA | 1\nB | 2";
  assert.equal(
    await run(`console.log([{ k: "A", n: 1 }, { k: "B", n: 2 }])`),
    table,
  );
  assert.equal(await run(`[{ k: "A", n: 1 }, { k: "B", n: 2 }]`), table);
  // A call printed without await says so.
  assert.match(await run(`console.log({ p: sleep(1) })`), /not awaited/);
});

void test("the last expression is the result; a script that prints nothing says so", async () => {
  assert.equal(await run(`const a = 20;\na + 1`), "21");
  assert.equal(await run(`const a: number = 1;\nreturn a + 1;`), "2");
  assert.equal(await run(`files.list("*.none")`), "[]");
  assert.equal(
    await run(`await sleep(1)`),
    "ok, no output (the last expression was undefined or empty)",
  );
  assert.equal(
    await run(`const a = 1;`),
    "ok, no output (the last statement is not an expression; return a value to print it)",
  );
  // Division after a closing bracket, and a parenthesized value after a block, are results.
  assert.equal(
    await run(`const t0 = 4;\n({ half: (t0 + 2) / 2 })`),
    '{"half":3}',
  );
  assert.equal(await run(`const a = (4) / 2;\n"after"`), "after");
  assert.equal(await run(`for (const k of [1]) { }\n(1 + 1)`), "2");
  assert.equal(await run(`const a = 1;\nif (a)\n  console.log("yes")`), "yes");
  // A rewrite that does not compile falls back to the script as written.
  assert.equal(await run(`console.log(1);\nlet x = 1\nx++\nx--`), "1");
});

void test("long strings, long arrays and large values are cut with a note", async () => {
  const text = await run(
    `({ big: "x".repeat(${PRINT_STRING_CHARS + 30}), list: Array.from({ length: ${PRINT_ROWS + 5} }, (_, i) => i) })`,
  );
  assert.ok(text.includes(`…[+30 chars]`));
  // Inside a value the note is an item; for a printed array it is a line of its own.
  assert.ok(text.endsWith(`,"[+5 more of ${PRINT_ROWS + 5}]"]}`));
  assert.ok(
    (
      await run(`Array.from({ length: ${PRINT_ROWS + 5} }, (_, i) => i)`)
    ).endsWith(`,99]\n[+5 more of ${PRINT_ROWS + 5}]`),
  );
  const rows = await run(
    `Array.from({ length: ${PRINT_ROWS + 1} }, (_, i) => ({ i }))`,
  );
  assert.equal(rows.split("\n").at(-1), `[+1 more of ${PRINT_ROWS + 1}]`);
  // A large array is cut between items and names the keys, so the next call can narrow without guessing.
  const large = (
    await run(
      `Array.from({ length: ${PRINT_ROWS} }, (_, i) => ({ i, nested: { text: "y".repeat(200) } }))`,
    )
  ).split("\n");
  assert.ok(large[0].length <= PRINT_VALUE_CHARS && large[0].endsWith("}]"));
  assert.match(
    large[1],
    /^\[\d+ of 100 items shown; keys: i, nested: print the fields you need, or artifacts\.write the value\]$/,
  );
  assert.equal(
    await run(`[{ a: "x|y", b: "z".repeat(${PRINT_CELL_CHARS + 7}) }]`),
    `a | b\nx\\|y | ${"z".repeat(PRINT_CELL_CHARS)}…[+7 chars]`,
  );
  // A string is the script's own text and is never cut.
  const whole = await run(`"z".repeat(${PRINT_VALUE_CHARS * 2})`);
  assert.equal(whole.length, PRINT_VALUE_CHARS * 2);
});

void test("an uncaught SDK failure is reported with its code, call and line", async () => {
  assert.equal(
    await run(`const a = 1;\nawait files.read("missing.txt")`),
    "NOT_FOUND: file not found: missing.txt\n    at files.read (script.ts:2)\nfailed · exit 1",
  );
  // A caught one is unchanged, and the declaration is appended once per method in a run.
  const lines = (
    await run(
      `for (const n of [1, 2]) { try { await files.read({ path: "a", nope: n }) } catch (e) { console.log(e.name, e.code, e.message) } }`,
    )
  ).split("\n");
  assert.match(
    lines[0],
    /^HostError BAD_REQUEST files\.read has no option 'nope'.* Declaration: files\.read\(/,
  );
  assert.match(
    lines[1],
    /^HostError BAD_REQUEST files\.read has no option 'nope'[^D]*$/,
  );
});
