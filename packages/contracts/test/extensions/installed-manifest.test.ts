import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionDefinitionData } from "@nervekit/extension-api";
import {
  compareVersions,
  defaultPreviewEdit,
  installedExtensionManifestSchema,
  manifestDefinitionData,
  oldestCompatibleSdkVersion,
  sdkCompatibilityProblem,
} from "../../src/domains/extensions/index.js";

const definition = {
  id: "csv-viewer",
  apiVersion: 1 as const,
  name: "CSV",
  description: "Views CSV.",
  icon: "blocks",
  enabledByDefault: true,
  settings: { version: 1, fields: {}, migrations: undefined },
  namespaces: [
    {
      id: "csv",
      summary: "CSV.",
      types: "",
      session: () => ({}),
      methods: {
        read: {
          risk: "read" as const,
          signature: "read()",
          parse: () => ({}),
          run: () => ({}),
        },
      },
    },
  ],
};

void test("a definition's data marks hooks as true and drops undefined", () => {
  const data = extensionDefinitionData(definition);
  assert.deepEqual(data.namespaces[0].methods.read, {
    risk: "read",
    signature: "read()",
    parse: true,
    run: true,
  });
  assert.equal(data.namespaces[0].session, true);
  assert.deepEqual(data.settings, { version: 1, fields: {} });
});

void test("the manifest is the definition's data plus version and sdkVersion; unknown fields fail", () => {
  const manifest = {
    ...JSON.parse(JSON.stringify(extensionDefinitionData(definition))),
    version: "1.0.0",
    sdkVersion: "0.41.1",
  };
  const parsed = installedExtensionManifestSchema.parse(manifest);
  assert.deepEqual(
    manifestDefinitionData(parsed),
    JSON.parse(JSON.stringify(extensionDefinitionData(definition))),
  );
  for (const bad of [
    { ...manifest, extra: 1 },
    { ...manifest, sdkVersion: "latest" },
    { ...manifest, id: "Not Valid" },
    {
      ...manifest,
      ui: {
        pages: [{ id: "x", label: "X", icon: "table", entry: "src/x.svelte" }],
      },
    },
    {
      ...manifest,
      namespaces: [{ ...manifest.namespaces[0], id: "has-dash" }],
    },
  ])
    assert.equal(
      installedExtensionManifestSchema.safeParse(bad).success,
      false,
    );
});

void test("built ui contributions have fixed output paths, unique ids and no extra fields", () => {
  const base = {
    ...JSON.parse(JSON.stringify(extensionDefinitionData(definition))),
    version: "1.0.0",
    sdkVersion: "0.41.1",
  };
  const ui = {
    previews: [
      {
        id: "table",
        label: "Table",
        match: { extensions: [".csv", ".tsv"] },
        edit: "custom",
        entry: "ui/table/index.html",
      },
    ],
    pages: [
      {
        id: "explorer",
        label: "Explorer",
        icon: "chart-bar",
        entry: "ui/explorer/index.html",
      },
    ],
    panels: [
      {
        id: "summary",
        label: "Summary",
        icon: "table",
        entry: "ui/summary/index.html",
      },
    ],
    themes: [
      { id: "dusk", label: "Dusk", kind: "dark", file: "themes/dusk.json" },
    ],
  };
  const parse = (value: unknown) =>
    installedExtensionManifestSchema.safeParse({ ...base, ui: value }).success;
  assert.equal(parse(ui), true);
  assert.equal(
    parse({ themes: [{ ...ui.themes[0], file: "../x.json" }] }),
    false,
  );
  assert.equal(
    parse({ themes: [{ id: "dusk", label: "D", file: "themes/dusk.json" }] }),
    false,
  );
  assert.equal(
    parse({
      previews: [{ ...ui.previews[0], entry: "src/ui/csv-table.svelte" }],
    }),
    false,
  );
  assert.equal(
    parse({
      previews: [{ ...ui.previews[0], match: { extensions: ["csv"] } }],
    }),
    false,
  );
  assert.equal(
    parse({ previews: [{ ...ui.previews[0], edit: "auto" }] }),
    false,
  );
  assert.equal(parse({ panels: [ui.panels[0], ui.panels[0]] }), false);
  assert.equal(parse({ ...ui, extra: [] }), false);
  assert.equal(defaultPreviewEdit([".csv"]), "source");
  assert.equal(defaultPreviewEdit([".pdf"]), "none");
});

void test("SDK compatibility is oldest <= sdk <= running version", () => {
  assert.equal(compareVersions("0.41.1", "0.41.1"), 0);
  assert.ok(compareVersions("0.41.1-beta.1", "0.41.1")! < 0);
  assert.equal(
    sdkCompatibilityProblem(oldestCompatibleSdkVersion, "0.41.1"),
    undefined,
  );
  assert.equal(sdkCompatibilityProblem("0.41.1", "0.41.1"), undefined);
  assert.match(
    sdkCompatibilityProblem("0.38.0", "0.41.1", "0.41.0")!,
    /Built with SDK 0\.38\.0; this Nerve needs 0\.41\.0 or later\. Ask the agent in the Forge profile to upgrade it\./,
  );
  assert.match(
    sdkCompatibilityProblem("0.50.0", "0.41.1")!,
    /newer than this Nerve/,
  );
});
