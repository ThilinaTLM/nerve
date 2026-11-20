import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildExtension, sdkVersion } from "../src/build.ts";
import { extensionKinds, initExtension } from "../src/init.ts";
import { ExtensionProjectError } from "../src/problems.ts";

async function withTemp<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "nerve-sdk-"));
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

for (const kind of extensionKinds)
  void test(`init and build a ${kind} extension`, async () => {
    await withTemp(async (root) => {
      const folder = await initExtension({ id: "demo-ext", kind, cwd: root });
      const { manifest } = await buildExtension({ projectDir: folder });
      assert.equal(manifest.id, "demo-ext");
      assert.equal(manifest.version, "0.1.0");
      assert.equal(manifest.sdkVersion, await sdkVersion());
      const written = JSON.parse(
        await readFile(join(folder, "dist", "manifest.json"), "utf8"),
      );
      assert.deepEqual(written, manifest);
      const backend = await readFile(
        join(folder, "dist", "backend.js"),
        "utf8",
      );
      assert.match(backend, /__nerveExtensionApi/);
      assert.doesNotMatch(backend, /require\(["']@nervekit/);
    });
  });

void test("several kinds combine into one project, each part in its own folder", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "combo",
      kind: ["integration", "panel", "theme"],
      cwd: root,
    });
    for (const file of [
      "src/backend/namespace.ts",
      "src/backend/get.test.ts",
      "src/panels/checklist/Checklist.svelte",
      "src/themes/combo.json",
      "src/env.d.ts",
      "docs/usage.md",
      ".gitignore",
    ])
      await readFile(join(folder, file), "utf8");
    const { manifest } = await buildExtension({ projectDir: folder });
    assert.deepEqual(
      manifest.namespaces.map((namespace) => namespace.id),
      ["combo"],
    );
    assert.equal(manifest.enabledByDefault, false);
    assert.deepEqual(Object.keys(manifest.ui ?? {}).sort(), [
      "panels",
      "themes",
    ]);
    await assert.rejects(
      initExtension({
        id: "other",
        kind: ["panel", "nope" as never],
        cwd: root,
      }),
      /not an extension kind/,
    );
  });
});

void test("init pins the SDK version exactly and refuses a bad id or a used folder", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "pinned",
      kind: "theme",
      cwd: root,
    });
    const pkg = JSON.parse(
      await readFile(join(folder, "package.json"), "utf8"),
    );
    assert.equal(
      pkg.dependencies["@nervekit/extension-sdk"],
      await sdkVersion(),
    );
    assert.match(
      await readFile(join(folder, ".gitignore"), "utf8"),
      /node_modules/,
    );
    await assert.rejects(
      initExtension({ id: "pinned", kind: "theme", cwd: root }),
      /not empty/,
    );
    await assert.rejects(
      initExtension({ id: "Bad_Id", kind: "theme", cwd: root }),
      /not a valid extension id/,
    );
    await assert.rejects(
      initExtension({
        id: "other",
        kind: "theme",
        cwd: root,
        dir: "elsewhere",
      }),
      /must equal the extension id/,
    );
  });
});

void test("a build error says what, where and the fix", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "broken",
      kind: "theme",
      cwd: root,
    });
    const file = join(folder, "src", "extension.ts");
    const source = await readFile(file, "utf8");
    await writeFile(
      file,
      source.replace(
        "enabledByDefault: true,",
        "enabledByDefault: true,\n  prelude: 'x',\n  colour: 1,",
      ),
    );
    const problems = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.ok(problems.length >= 1);
    for (const problem of problems) {
      assert.ok(problem.what && problem.where && problem.fix);
    }
    assert.ok(problems.some((problem) => /prelude/.test(problem.what)));
  });
});

void test("the backend cannot import test helpers or Node built-ins", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "imports",
      kind: "theme",
      cwd: root,
    });
    const file = join(folder, "src", "extension.ts");
    await writeFile(
      file,
      `import "@nervekit/extension-sdk/testing";\nimport "node:fs";\n${await readFile(file, "utf8")}`,
    );
    const problems = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.ok(problems.some((problem) => /test helpers/.test(problem.what)));
    assert.ok(problems.some((problem) => /node:fs/.test(problem.what)));
    assert.ok(
      problems.every((problem) => /extension\.ts:\d+:\d+/.test(problem.where)),
    );
  });
});

void test("a folder named differently from the id is refused", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "one-name",
      kind: "theme",
      cwd: root,
    });
    const renamed = join(root, "another");
    await mkdir(renamed);
    await (
      await import("node:fs/promises")
    ).cp(folder, renamed, { recursive: true });
    const problems = await problemsOf(() =>
      buildExtension({ projectDir: renamed }),
    );
    assert.match(problems[0]!.what, /folder name 'another' must equal/);
  });
});

void test("an icon outside the host's list is a build problem", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "icons",
      kind: "page",
      cwd: root,
    });
    const file = join(folder, "src", "extension.ts");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        /icon: "[a-z-]+",\n {2}enabledByDefault/,
        'icon: "palette",\n  enabledByDefault',
      ),
    );
    const problems = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.match(problems[0]!.what, /Unknown icon 'palette'/);
    assert.match(problems[0]!.fix, /blocks/);
  });
});

void test("docs and the icon are copied and checked", async () => {
  await withTemp(async (root) => {
    const folder = await initExtension({
      id: "assets",
      kind: "theme",
      cwd: root,
    });
    const file = join(folder, "src", "extension.ts");
    const source = (await readFile(file, "utf8"))
      .replace(
        /icon: "[a-z-]+",\n {2}enabledByDefault/,
        'icon: "icon.svg",\n  enabledByDefault',
      )
      .replace(
        "namespaces: [],",
        `namespaces: [defineNamespace({ id: "assets", summary: "Assets.", types: "", methods: {}, docs: [{ id: "assets/guide", whenToRead: "before using assets", file: "docs/guide.md" }] })],`,
      )
      .replace("{ defineExtension }", "{ defineExtension, defineNamespace }");
    await writeFile(file, source);
    const missing = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.ok(missing.some((problem) => /icon\.svg/.test(problem.what)));
    await writeFile(
      join(folder, "icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>',
    );
    const noDoc = await problemsOf(() =>
      buildExtension({ projectDir: folder }),
    );
    assert.ok(noDoc.some((problem) => /docs\/guide\.md/.test(problem.what)));
    await mkdir(join(folder, "docs"));
    await writeFile(join(folder, "docs", "guide.md"), "# Guide\n");
    await buildExtension({ projectDir: folder });
    assert.equal(
      await readFile(join(folder, "dist", "docs", "guide.md"), "utf8"),
      "# Guide\n",
    );
    assert.match(
      await readFile(join(folder, "dist", "icon.svg"), "utf8"),
      /<svg/,
    );
  });
});

void test("scaffolded frames use no <form>: the frame sandbox has no allow-forms", async () => {
  const { projectTemplate } = await import("../src/templates.ts");
  for (const [file, text] of Object.entries(
    projectTemplate("probe", extensionKinds, "0.0.0"),
  ))
    assert.ok(!text.includes("<form"), `${file} uses <form>`);
});
