import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PRINT_CELL_CHARS,
  PRINT_NESTED_COLUMNS,
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
  // One nested level becomes columns and anything deeper is JSON in its cell; rows of different shapes stay JSON.
  assert.equal(
    await run(
      `[{ n: 1, user: { login: "a", tags: ["x"] } }, { n: 2, user: { login: "b", tags: [] } }]`,
    ),
    'n | user.login | user.tags\n1 | a | ["x"]\n2 | b | []',
  );
  // Flattening that would make a wide table (an API object with many nested fields) stays JSON.
  assert.match(
    await run(
      `[1, 2].map((n) => ({ n, user: Object.fromEntries(Array.from({ length: ${PRINT_NESTED_COLUMNS} }, (_, i) => ["k" + i, i])) }))`,
    ),
    /^\[\{"n":1,"user":\{"k0":0,/,
  );
  assert.equal(
    await run(`[{ a: 1 }, { b: 2 }, { c: 3 }]`),
    '[{"a":1},{"b":2},{"c":3}]',
  );
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
  // An object literal alone on the last line is a value; a real block still runs as written.
  assert.equal(await run(`const a = 1;\n{ a, b: 2 }`), '{"a":1,"b":2}');
  assert.equal(await run(`const a = 1;\n{ console.log(a); }`), "1");
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
  assert.equal(large[0], "i | nested.text");
  assert.ok(large.slice(0, -1).join("\n").length <= PRINT_VALUE_CHARS);
  assert.match(
    large.at(-1)!,
    /^\[\d+ of 100 items shown; keys: i, nested: print the fields you need, or artifacts\.write the value\]$/,
  );
  const lists = (
    await run(
      `Array.from({ length: ${PRINT_ROWS} }, (_, i) => [i, "y".repeat(200)])`,
    )
  ).split("\n");
  assert.ok(lists[0].endsWith('"]]') && lists[0].length <= PRINT_VALUE_CHARS);
  assert.match(lists[1], /^\[\d+ of 100 items shown: print the fields/);
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

void test("the SDK-call limit is a coded failure that says what to do", async () => {
  const text = await run(
    `try { for (let i = 0; i < 250; i++) await files.list("*.none"); } catch (e) { console.log(e.code, e.message) }`,
  );
  assert.equal(
    text.split("\n")[0],
    "RATE_LIMITED SDK call limit of 200 per run reached; split the work over several scripts.",
  );
});

void test("a script beyond the concurrent limit does not start and says to run it again", async () => {
  const runs = await Promise.allSettled(
    Array.from({ length: 6 }, () => run(`await sleep(300)`)),
  );
  const refused = runs.filter((result) => result.status === "rejected");
  assert.equal(refused.length, 2);
  assert.equal(
    (refused[0].reason as Error).message,
    "4 scripts are already running, the most at once. This one did not start: run it again when one of them has finished.",
  );
});
