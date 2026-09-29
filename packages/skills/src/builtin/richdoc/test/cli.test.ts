import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseChart } from "../src/schema/index.js";
import { checkDiagram } from "../src/schema/diagram.js";
const source = resolve(import.meta.dirname, "..");
const skill = resolve(source, "../../../dist/builtin/richdoc");
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), "richdoc-cli-"));
  const copy = join(root, "copied skill");
  await cp(skill, copy, { recursive: true });
  const script = join(copy, "scripts/richdoc.mjs");
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NERVE_HOME: join(root, "nerve-home") },
    });
    assert.equal(result.signal, null, result.stderr);
    return { status: result.status, result: JSON.parse(result.stdout) };
  };
  const document = join(root, "output", "index.html");
  return {
    root,
    copy,
    document,
    run,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("copied skill runs with no install; prepare preserves documents and handles assets explicitly", async () => {
  const f = await fixture();
  try {
    assert.equal(f.run("describe").result.elements.length, 12);
    const prepared = f.run(
      "prepare",
      "output",
      "--file",
      "index.html",
      "--title",
      "A & B",
    );
    assert.equal(prepared.status, 0);
    assert.match(await readFile(f.document, "utf8"), /A &amp; B/);
    assert.equal(f.run("validate", f.document).status, 0);
    const noOp = f.run("prepare", "output");
    assert.equal(noOp.result.created.length, 0);
    assert.ok(noOp.result.unchanged.length > 5);
    assert.equal(
      f.run("prepare", "output", "--file", "index.html", "--replace-assets")
        .status,
      1,
    );
    const css = join(f.root, "output/richdoc-assets/richdoc.css");
    await writeFile(css, "edited");
    assert.equal(f.run("prepare", "output").result.code, "ASSET_CONFLICT");
    assert.equal(await readFile(css, "utf8"), "edited");
    assert.equal(f.run("validate", f.document).status, 1);
    assert.equal(f.run("prepare", "output", "--replace-assets").status, 0);
    assert.equal(f.run("validate", f.document).status, 0);
    assert.equal(
      f.run("prepare", "nested", "--file", "deep/report.html").status,
      0,
    );
    assert.equal(
      f.run("validate", join(f.root, "nested/deep/report.html")).status,
      0,
    );
    assert.equal(
      f.run("prepare", "output", "--file", "../../escape.html").status,
      1,
    );
    assert.equal(f.run("describe", "--tag", "rd-hero").status, 1);
  } finally {
    await f.close();
  }
});

test("validation diagnoses schema, escaping, accessibility, structure and unsafe resources without executing HTML", async () => {
  const f = await fixture();
  try {
    f.run("prepare", "output", "--file", "index.html");
    const original = await readFile(f.document, "utf8");
    const bad = original.replace(
      "</rd-page>",
      `<rd-hero title="Legacy"></rd-hero><rd-card typo="x" />
      <rd-icon name="not-bundled"></rd-icon><rd-chart x="a" y="b" title="Broken">[{"a":1,"b":"bad"}]</rd-chart>
      <rd-code><b>not escaped</b></rd-code><h3 id="same">Skipped</h3><p id="same">Duplicate</p>
      <a href="#absent">Missing</a><img src="https://example.invalid/image.png"><progress value="4"></progress>
      <script>require('node:fs').writeFileSync('should-not-exist', 'unsafe')</script><p onclick="alert(1)">Unsafe</p></rd-page>`,
    );
    await writeFile(f.document, bad);
    const validation = f.run("validate", f.document);
    assert.equal(validation.status, 1);
    const codes = new Set(
      validation.result.diagnostics.map((d: { code: string }) => d.code),
    );
    for (const code of [
      "UNKNOWN_ELEMENT",
      "SELF_CLOSING_CUSTOM_ELEMENT",
      "UNKNOWN_ATTRIBUTE",
      "INVALID_ATTRIBUTE",
      "CHART_DATA",
      "SOURCE_ESCAPING",
      "DUPLICATE_ID",
      "BROKEN_FRAGMENT",
      "IMAGE_ALT",
      "PROGRESS_LABEL",
      "UNTRUSTED_SCRIPT",
      "EXECUTABLE_ATTRIBUTE",
      "LOCAL_RESOURCE",
    ])
      assert.ok(codes.has(code), code);
    assert.ok(
      validation.result.diagnostics.some(
        (d: { line?: number; column?: number }) => d.line && d.column,
      ),
    );
    assert.equal(await readFile(f.document, "utf8"), bad);
    assert.ok(!(await readdir(f.root)).includes("should-not-exist"));
    await writeFile(
      f.document,
      original.replace(
        "</rd-page>",
        '<a href="https://example.invalid/reference">External citation</a></rd-page>',
      ),
    );
    assert.equal(f.run("validate", f.document).status, 0);
  } finally {
    await f.close();
  }
});

test("prepare and validation reject symlink destinations and resources", async () => {
  const f = await fixture();
  try {
    f.run("prepare", "output", "--file", "index.html");
    await symlink(join(f.root, "output"), join(f.root, "linked"), "dir");
    assert.equal(f.run("prepare", "linked").status, 1);
    const css = join(f.root, "output/richdoc-assets/richdoc.css");
    const external = join(f.root, "outside.css");
    await writeFile(external, "secret");
    await rm(css);
    await symlink(external, css);
    assert.equal(f.run("prepare", "output", "--replace-assets").status, 1);
    assert.equal(f.run("validate", f.document).status, 1);
    assert.equal(await readFile(external, "utf8"), "secret");
  } finally {
    await f.close();
  }
});

test("validation bounds findings and input sizes", async () => {
  const f = await fixture();
  try {
    f.run("prepare", "output", "--file", "index.html");
    const original = await readFile(f.document, "utf8");
    await writeFile(
      f.document,
      original.replace(
        "</rd-page>",
        "<rd-invalid></rd-invalid>".repeat(150) + "</rd-page>",
      ),
    );
    const result = f.run("validate", f.document).result;
    assert.equal(result.diagnostics.length, 100);
    assert.ok(result.omitted >= 50);
    await writeFile(f.document, "x".repeat(5 * 1024 * 1024 + 1));
    assert.equal(f.run("validate", f.document).status, 1);
  } finally {
    await f.close();
  }
});

test("all original example documents validate from a prepared folder", async () => {
  const f = await fixture();
  try {
    f.run("prepare", "output");
    for (const name of await readdir(join(skill, "examples"))) {
      const output = join(f.root, "output", name);
      await cp(join(skill, "examples", name), output);
      const result = f.run("validate", output);
      assert.equal(
        result.status,
        0,
        `${name}: ${JSON.stringify(result.result)}`,
      );
      assert.equal(result.result.warnings, 0, name);
    }
  } finally {
    await f.close();
  }
});

test("CSV parsing preserves quoted commas, newlines and finite numeric values", () => {
  assert.deepEqual(parseChart('name,value\n"A,B",2\n"line\nbreak",3', "csv"), [
    { name: "A,B", value: 2 },
    { name: "line\nbreak", value: 3 },
  ]);
  assert.throws(() => parseChart('name,value\n"unclosed,2', "csv"));
  assert.throws(() => parseChart('[{"value":null}]'));
});

test("diagram sources cannot override security or introduce external resources", () => {
  checkDiagram("graph TD\n A --> B");
  for (const source of [
    '%%{init: {"securityLevel":"loose"}}%%\ngraph TD; A --> B',
    'graph TD; A@{ img: "https://example.invalid/image.png" }',
    "graph TD; A --> B; classDef remote fill:url(https://example.invalid/image)",
    "---\nconfig:\n  securityLevel: loose\n---\ngraph TD; A --> B",
  ])
    assert.throws(() => checkDiagram(source));
});

test(
  "packaged skill bundles and references are reproducible",
  { timeout: 120_000 },
  () => {
    execFileSync(
      process.execPath,
      [join(source, "build/build.mjs"), "--check"],
      { encoding: "utf8", timeout: 120_000 },
    );
  },
);
