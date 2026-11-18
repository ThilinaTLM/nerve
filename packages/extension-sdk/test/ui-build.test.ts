import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildExtension } from "../src/build.ts";
import { initExtension, type ExtensionKind } from "../src/init.ts";
import { ExtensionProjectError } from "../src/problems.ts";
import { extractThemeBlocks } from "../src/ui-build.ts";

async function withTemp<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "nerve-sdk-ui-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function problemsOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (cause) {
    assert.ok(cause instanceof ExtensionProjectError, String(cause));
    return cause.problems;
  }
  assert.fail("expected the build to fail");
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? (await listFiles(join(dir, entry.name))).map((f) =>
            join(entry.name, f),
          )
        : [entry.name],
    ),
  );
  return nested.flat();
}

const frameKinds: {
  kind: ExtensionKind;
  section: "previews" | "pages" | "panels";
  id: string;
}[] = [
  { kind: "preview", section: "previews", id: "table" },
  { kind: "page", section: "pages", id: "overview" },
  { kind: "panel", section: "panels", id: "checklist" },
];

for (const { kind, section, id } of frameKinds)
  void test(`a ${kind} extension builds a frame under dist/ui/${id}`, async () => {
    await withTemp(async (root) => {
      const folder = await initExtension({ id: "frame-ext", kind, cwd: root });
      const { manifest, distDir } = await buildExtension({
        projectDir: folder,
      });
      const entry = manifest.ui?.[section]?.[0];
      assert.equal(entry?.id, id);
      assert.equal(entry?.entry, `ui/${id}/index.html`);
      if (kind === "preview")
        assert.equal((entry as { edit: string }).edit, "source");

      const frame = join(distDir, "ui", id);
      const html = await readFile(join(frame, "index.html"), "utf8");
      // The frame's CSP has no 'unsafe-inline' for scripts: one external module script, no inline code.
      const scripts = [...html.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/gi)];
      assert.equal(scripts.length, 1);
      assert.match(scripts[0]![1]!, /type="module"/);
      assert.match(scripts[0]![1]!, /src="\.\/assets\/[^"]+\.js"/);
      assert.equal(scripts[0]![2], "");
      assert.doesNotMatch(html, /\son[a-z]+=|javascript:/i);
      // Every URL is relative: the frame is served under a per-extension path.
      for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g))
        assert.match(url!, /^\.\/assets\//, url);
      const files = await listFiles(frame);
      assert.ok(files.some((file) => file.endsWith(".js")));
      const css = files.find((file) => file.endsWith(".css"));
      assert.ok(css, "the frame has a stylesheet");
      const styles = await readFile(join(frame, css), "utf8");
      // Utilities resolve to the host's variables; the build ships no token values.
      assert.match(styles, /\.bg-card\{background-color:var\(--card\)\}/);
      assert.match(
        styles,
        /\.text-muted-foreground\{color:var\(--muted-foreground\)\}/,
      );
      assert.doesNotMatch(styles, /--background:\s*[#o]/);
      assert.doesNotMatch(html + styles, /data:(?:image|font|application)/);
      // The work folder of the build is gone.
      await assert.rejects(readdir(join(folder, ".nerve-ext")));
    });
  });

void test("a theme extension copies and describes its theme file", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "sun-theme",
      kind: "theme",
      cwd: root,
    });
    const { manifest, distDir } = await buildExtension({ projectDir: folder });
    assert.deepEqual(manifest.ui, {
      themes: [
        {
          id: "sun-theme",
          label: "Sun Theme",
          kind: "light",
          file: "themes/sun-theme.json",
        },
      ],
    });
    const copied = JSON.parse(
      await readFile(join(distDir, "themes", "sun-theme.json"), "utf8"),
    );
    assert.equal(Object.keys(copied.tokens).length, 17);
    assert.deepEqual((await listFiles(distDir)).sort(), [
      "backend.js",
      "manifest.json",
      join("themes", "sun-theme.json"),
    ]);
  });
});

void test("theme files are validated: schema, id and readability", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "bad-theme",
      kind: "theme",
      cwd: root,
    });
    const file = join(folder, "themes", "bad-theme.json");
    const theme = JSON.parse(await readFile(file, "utf8"));
    const write = (value: unknown) => writeFile(file, JSON.stringify(value));

    const missing = structuredClone(theme);
    delete missing.tokens.primary;
    missing.tokens.background = "url(x)";
    await write(missing);
    const schema = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.ok(
      schema.some((problem) =>
        /Invalid theme file themes\/bad-theme\.json at tokens\.primary/.test(
          problem.what,
        ),
      ),
    );
    assert.ok(
      schema.some((problem) => /tokens\.background/.test(problem.what)),
    );

    await write({ ...theme, id: "other" });
    const mismatch = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.match(mismatch[0]!.what, /id 'other'/);

    // Light text on a light background fails the host's readability rules.
    await write({
      ...theme,
      tokens: { ...theme.tokens, foreground: "#fafafa" },
    });
    const unreadable = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.match(unreadable[0]!.what, /not readable enough/);
    await assert.rejects(
      readdir(join(folder, "dist")),
      "a failed build leaves no dist/",
    );
  });
});

void test("UI that imports a component a frame cannot show fails with the host replacement", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "forbidden-ui",
      kind: "page",
      cwd: root,
    });
    await writeFile(
      join(folder, "src", "ui", "overview.svelte"),
      `<script lang="ts">
  import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
  import { Toaster } from "@nervekit/ui-kit/components/ui/sonner";
  import * as Menu from "@nervekit/ui-kit/components/ui/dropdown-menu";
</script>
<Dialog.Root />
<Toaster />
<Menu.Root />
`,
    );
    const problems = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    const fixes = problems.map((problem) => problem.fix).join("\n");
    assert.match(fixes, /host\.ui\.confirm/);
    assert.match(fixes, /host\.ui\.notify/);
    assert.match(fixes, /host\.ui\.showMenu/);
    assert.ok(
      problems.every((problem) => problem.where.endsWith("overview.svelte")),
    );
    assert.match(problems[0]!.what, /cannot work inside an extension frame/);
    await assert.rejects(readdir(join(folder, "dist")));
  });
});

void test("a missing entry, an unknown field and a bad source file are reported with their place", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "bad-entry",
      kind: "preview",
      cwd: root,
    });
    const file = join(folder, "src", "extension.ts");
    const source = await readFile(file, "utf8");
    await writeFile(
      file,
      source.replace('"src/ui/table.svelte"', '"src/ui/missing.svelte"'),
    );
    const missing = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.equal(missing[0]!.what, "src/ui/missing.svelte does not exist.");
    assert.match(missing[0]!.where, /ui\.previews\[0\]\.entry/);

    await writeFile(
      file,
      source.replace("match:", "matches: 1,\n        match:"),
    );
    const unknown = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.match(
      unknown[0]!.what,
      /Unknown field matches in ui\.previews\[0\]/,
    );

    await writeFile(file, source.replace('".csv", ".tsv"', '"csv"'));
    const extension = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.match(
      extension[0]!.what,
      /ui\.previews\[0\]\.match\.extensions\[0\]/,
    );
    assert.match(extension[0]!.fix, /with its dot/);

    await mkdir(join(folder, "src", "ui"), { recursive: true });
    await writeFile(
      join(folder, "src", "ui", "broken.svelte"),
      '<script lang="ts">let x: = ;</script>\n',
    );
    await writeFile(file, source.replace("table.svelte", "broken.svelte"));
    const broken = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.match(broken[0]!.what, /The UI build of 'table' failed/);
    assert.match(broken[0]!.where, /broken\.svelte/);
  });
});

void test("preview edit defaults to none for binary formats and keeps an explicit custom", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "edit-modes",
      kind: "preview",
      cwd: root,
    });
    const file = join(folder, "src", "extension.ts");
    const source = await readFile(file, "utf8");
    await writeFile(
      file,
      source.replace('[".csv", ".tsv"]', '[".png", ".webp"]'),
    );
    assert.equal(
      (await buildExtension({ projectDir: folder })).manifest.ui?.previews?.[0]
        ?.edit,
      "none",
    );
    await writeFile(
      file,
      source.replace("entry:", 'edit: "custom",\n        entry:'),
    );
    assert.equal(
      (await buildExtension({ projectDir: folder })).manifest.ui?.previews?.[0]
        ?.edit,
      "custom",
    );
  });
});

void test("extractThemeBlocks keeps the @theme mappings and none of the token values", () => {
  const blocks = extractThemeBlocks(`:root { --background: red; }
@theme {
  --spacing-control: 1rem;
}
@media (pointer: coarse) { :root { --x: 1; } }
@theme inline {
  --color-card: var(--card);
  --x: calc(var(--radius) * 2);
}
:root[data-theme="a"] { --foreground: blue; }`);
  assert.match(blocks, /^@theme \{\n {2}--spacing-control: 1rem;\n\}/);
  assert.match(
    blocks,
    /@theme inline \{[\s\S]*--color-card: var\(--card\);[\s\S]*\}$/,
  );
  assert.doesNotMatch(blocks, /--background|--foreground|--x: 1/);
});
