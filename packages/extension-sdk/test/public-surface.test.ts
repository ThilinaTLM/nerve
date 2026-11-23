// Fails when the public surface an extension is built against changes, so a change is a decision:
// the emitted declarations of the extension API and SDK entries, the UI bridge table and the
// installed-manifest and theme JSON Schemas are compared with `public-surface.snapshot.txt`.
//
// Update the snapshot with:  UPDATE_SNAPSHOT=1 pnpm exec tsx --test test/public-surface.test.ts
// (in packages/extension-sdk). Only after deciding which of the two it is, below.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import {
  bridgeEventKinds,
  bridgeEvents,
  bridgeMethodKinds,
  bridgeMethods,
  bridgeProtocolVersion,
  installedExtensionManifestSchema,
  oldestCompatibleSdkVersion,
  themeFileSchema,
} from "@nervekit/contracts/extensions";

const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, "..", "..");
const snapshotFile = join(here, "public-surface.snapshot.txt");

/** The entries an extension author imports (`@nervekit/extension-api[/testing]`, `@nervekit/extension-sdk[/testing|/ui]`). */
const entries = [
  "extension-api/src/index.ts",
  "extension-api/src/testing.ts",
  "extension-sdk/src/index.ts",
  "extension-sdk/src/testing.ts",
  "extension-sdk/src/ui.ts",
].map((entry) => join(packages, entry));

/** Declarations of the public entries, without comments (wording is not surface). */
function declarations(): Map<string, string> {
  const apiSrc = join(packages, "extension-api", "src");
  const outDir = join(packages, "declarations-snapshot");
  const program = ts.createProgram(entries, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
    removeComments: true,
    noEmitOnError: false,
    rootDir: packages,
    outDir,
    baseUrl: join(here, ".."),
    // Read the API's sources, not a possibly stale dist.
    paths: {
      "@nervekit/extension-api": [join(apiSrc, "index.ts")],
      "@nervekit/extension-api/testing": [join(apiSrc, "testing.ts")],
    },
  });
  const files = new Map<string, string>();
  program.emit(undefined, (fileName, text) => {
    files.set(relative(outDir, fileName).split("\\").join("/"), text);
  });
  // Hand-written declaration files (the UI components) are surface as they are.
  for (const source of program.getSourceFiles()) {
    const path = relative(packages, source.fileName).split("\\").join("/");
    if (source.isDeclarationFile && /^extension-(api|sdk)\/src\//.test(path))
      files.set(path, source.text.replace(/\/\*\*[\s\S]*?\*\//g, ""));
  }
  return files;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const schemaOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });

function snapshot(): string {
  const sections: [string, string][] = [
    ...[...declarations()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([file, text]): [string, string] => [`declarations ${file}`, text]),
    [
      "ui bridge",
      json({
        protocolVersion: bridgeProtocolVersion,
        methods: Object.fromEntries(
          Object.entries(bridgeMethods).map(([name, method]) => [
            name,
            {
              kinds: bridgeMethodKinds[name as keyof typeof bridgeMethodKinds],
              params: schemaOf(method.params),
              result: schemaOf(method.result),
            },
          ]),
        ),
        events: Object.fromEntries(
          Object.entries(bridgeEvents).map(([name, payload]) => [
            name,
            {
              kinds: bridgeEventKinds[name as keyof typeof bridgeEventKinds],
              payload: schemaOf(payload),
            },
          ]),
        ),
      }),
    ],
    [
      "installed manifest schema",
      json(schemaOf(installedExtensionManifestSchema)),
    ],
    ["theme file schema", json(schemaOf(themeFileSchema))],
  ];
  return sections
    .map(([name, text]) => `===== ${name} =====\n${text.trimEnd()}\n`)
    .join("\n");
}

function firstDifference(expected: string, actual: string): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  let section = "";
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]?.startsWith("===== ")) section = a[i]!;
    if (a[i] !== b[i])
      return `${section}\n  line ${i + 1}\n  snapshot: ${a[i] ?? "(end)"}\n  current:  ${b[i] ?? "(end)"}`;
  }
  return "";
}

void test("the public extension surface matches the committed snapshot", () => {
  const current = snapshot();
  if (process.env.UPDATE_SNAPSHOT) {
    writeFileSync(snapshotFile, current);
    return;
  }
  const committed = readFileSync(snapshotFile, "utf8");
  assert.ok(
    committed === current,
    [
      "The public surface of extensions changed (first difference below).",
      "Decide which it is:",
      "  - Additive (a new optional field, a new export, a new bridge method): update the snapshot.",
      `  - Breaking (a removed or changed name, type, field or method): raise oldestCompatibleSdkVersion (currently ${JSON.stringify(oldestCompatibleSdkVersion)}; packages/contracts/src/domains/extensions/compatibility.ts), add a section to packages/extension-sdk/UPGRADING.md, then update the snapshot.`,
      "Update the snapshot: cd packages/extension-sdk && UPDATE_SNAPSHOT=1 pnpm exec tsx --test test/public-surface.test.ts",
      "",
      firstDifference(committed, current),
    ].join("\n"),
  );
});
