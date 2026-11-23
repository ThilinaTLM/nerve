// The component declarations of `@nervekit/extension-sdk/ui` are generated from the Svelte sources
// (`scripts/components-dts.ts`, run by `pnpm build`). These tests generate them afresh and check
// what an author or agent depends on: every export of the implementation is declared with its real
// prop types (not `any`), each component and prop carries its doc comment, and frames cannot reach
// the components that need to draw outside them.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { frameForbidden } from "../src/ui-build.ts";
import { withGeneratedComponents } from "./component-declarations.ts";

const source = (path: string) =>
  readFile(new URL(`../src/components/${path}`, import.meta.url), "utf8");

/** Props every component takes by convention; their meaning is the same everywhere. */
const conventional = new Set(["class", "ref", "children"]);

/** Value specifiers of `import … from` and `export … from` (type-only ones are erased). */
function valueSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(
    /^(?:import|export)\s(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms,
  ))
    specifiers.push(match[1]!);
  for (const match of text.matchAll(/^import\s+["']([^"']+)["']/gm))
    specifiers.push(match[1]!);
  return specifiers;
}

/** Names the implementation exports, namespaces (`export * as Tabs`) included. */
function implementationExports(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/^export (?:type )?\{([^}]+)\} from/gm))
    for (const part of match[1]!.split(","))
      if (part.trim()) names.push(part.trim().replace(/^.* as /, ""));
  for (const match of text.matchAll(/^export \* as (\w+) from/gm))
    names.push(match[1]!);
  return names.sort();
}

void test("every export of components.impl.ts is declared, with its real prop types", async () => {
  const implementation = await source("components.impl.ts");
  await withGeneratedComponents(async ({ root, declarations, files }) => {
    const declared = [
      ...new Set(declarations.exports.map((name) => name.split(".")[0]!)),
    ].sort();
    assert.deepEqual(declared, implementationExports(implementation));
    // The SDK's own components and the UI kit's ship as declarations of their own.
    for (const file of [
      "components.d.ts",
      "select-field.svelte.d.ts",
      "floating-toolbar-menu.svelte.d.ts",
      "ui-kit/components/composites/panel/panel-row.svelte.d.ts",
    ])
      assert.ok(files.includes(file), `${file} is generated`);

    // A component that fell back to `any` (a failed resolution) accepts anything: wrong props
    // must be errors, right props must not be.
    const fixture = join(root, "fixture.ts");
    const lines = [
      `import type { ComponentProps } from "svelte";`,
      `import { Button, Callout, PanelHeader, PanelRow, SelectField, FloatingToolbarMenu, type ContextMenuItem } from "./components/components.js";`,
      `const ok1: ComponentProps<typeof Callout> = { tone: "info", title: "Saved" };`,
      `const ok2: ComponentProps<typeof PanelRow<string>> = { label: "a", menuItems: [{ label: "Copy", icon: "copy" }] };`,
      `const ok3: ComponentProps<typeof SelectField> = { items: [{ value: "a", label: "A" }], value: "a" };`,
      `const ok4: ContextMenuItem = { type: "separator" };`,
      `const bad1: ComponentProps<typeof Callout> = { tone: "loud" }; // error`,
      `const bad2: ComponentProps<typeof PanelHeader> = { count: 1 }; // error: title is required`,
      `const bad3: ComponentProps<typeof PanelRow<string>> = { label: "a", menuItems: [{ type: "bogus" }] }; // error`,
      `const bad4: ComponentProps<typeof SelectField> = { items: [{ value: "a" }] }; // error`,
      `const bad5: ComponentProps<typeof Button> = { variant: "huge" }; // error`,
      `const bad6: ComponentProps<typeof FloatingToolbarMenu> = { onSelect: () => {} }; // error: items is required`,
      `export { ok1, ok2, ok3, ok4, bad1, bad2, bad3, bad4, bad5, bad6 };`,
    ];
    await writeFile(fixture, lines.join("\n"));
    const program = ts.createProgram([fixture], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    });
    const errorLines = ts
      .getPreEmitDiagnostics(program, program.getSourceFile(fixture))
      .map(
        (diagnostic) =>
          program
            .getSourceFile(fixture)!
            .getLineAndCharacterOfPosition(diagnostic.start!).line,
      );
    const expected = lines.flatMap((line, index) =>
      line.includes("// error") ? [index] : [],
    );
    assert.deepEqual(
      [...new Set(errorLines)].sort((a, b) => a - b),
      expected,
      "the fixture's errors are exactly the lines marked `// error`",
    );
  });
});

void test("every component, function, type and prop declared in the UI kit or SDK has a doc comment", async () => {
  await withGeneratedComponents(({ declarations }) => {
    const missing: string[] = [];
    for (const component of declarations.components) {
      if (!component.own) continue;
      if (!component.documented) missing.push(component.name);
      for (const prop of component.props)
        if (!prop.documented && !conventional.has(prop.name))
          missing.push(`${component.name}.${prop.name}`);
    }
    for (const entry of [...declarations.functions, ...declarations.types])
      if (!entry.documented) missing.push(entry.name);
    assert.deepEqual(
      missing,
      [],
      "Document each with a JSDoc comment on the prop and an `<!-- @component -->` comment at the top of the .svelte file (ui-kit), or on the function or type.",
    );
    assert.ok(declarations.components.length > 90);
  });
});

void test("frames cannot reach the components that need to draw outside them", async () => {
  const files = [
    "components.impl.ts",
    "floating-toolbar-menu.svelte",
    "item-menu.svelte",
    "select-field.svelte",
  ];
  for (const file of files)
    for (const specifier of valueSpecifiers(await source(file)))
      for (const rule of frameForbidden)
        assert.doesNotMatch(
          specifier,
          rule.pattern,
          `${file} imports '${specifier}' (${rule.name}); frameForbidden in src/ui-build.ts lists what a frame cannot use`,
        );
});

// `@nervekit/extension-sdk/ui` exports every Lucide icon next to the components. A component
// with an icon's name shadows it (its icon stays available as `<Name>Icon`), so each shadowing
// must be explicit in src/ui.ts and listed here.
void test("component names that shadow a Lucide icon are explicit exports of src/ui.ts", async () => {
  const dist = dirname(
    createRequire(import.meta.url).resolve("@lucide/svelte"),
  );
  const icons = new Set<string>();
  for (const file of [
    "icons/index.js",
    "aliases/index.js",
    "aliases/aliases.js",
    "aliases/prefixed.js",
    "aliases/suffixed.js",
  ])
    for (const match of (await readFile(join(dist, file), "utf8")).matchAll(
      / as (\w+) \}/g,
    ))
      icons.add(match[1]!);
  await withGeneratedComponents(async ({ declarations }) => {
    const values = [
      ...declarations.components.map((component) => component.name),
      ...declarations.functions.map((entry) => entry.name),
    ].map((name) => name.split(".")[0]!);
    const shadowing = [...new Set(values)]
      .filter((name) => icons.has(name))
      .sort();
    assert.deepEqual(shadowing, ["Badge"]);
    const entry = await readFile(
      new URL("../src/ui.ts", import.meta.url),
      "utf8",
    );
    for (const name of shadowing)
      assert.match(
        entry,
        new RegExp(`export \\{ ${name} \\} from "./components/components.js"`),
      );
  });
});
