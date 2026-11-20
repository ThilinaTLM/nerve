import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { permissionRuleSchema } from "../../packages/contracts/src/domains/permissions/permission-rule-sets.ts";
import {
  agentPreferencesSchema,
  profileDefinitionSchema,
} from "../../packages/contracts/src/domains/agent-configuration/schemas.ts";
import {
  permissionOverlayDocumentSchema,
  permissionRuleSetSchema,
} from "../../packages/contracts/src/domains/permissions/permission-rule-sets.ts";
import { launchDefinitionFileSchema } from "../../packages/contracts/src/domains/launch-definitions/launch-definition.ts";
import { themeTokenNames } from "../../packages/contracts/src/domains/extensions/theme-file.ts";
import { repoRoot } from "../workspace/repo.ts";
import {
  generateConfigurationSchemas,
  writeSkillReferenceAssets,
} from "./skill-reference-assets.ts";

const skillSource = join(
  repoRoot,
  "packages/workbench-server/src/builtin-skills/builtin/configure-nerve",
);

test("generates a described JSON Schema for every configuration file", () => {
  const schemas = generateConfigurationSchemas();
  assert.deepEqual(Object.keys(schemas).sort(), [
    "agent-preferences.project.schema.json",
    "agent-preferences.user.schema.json",
    "agent-profile.project.schema.json",
    "agent-profile.user.schema.json",
    "launch-definitions.schema.json",
    "permission-overlays.project.schema.json",
    "permission-overlays.user.schema.json",
    "permission-rule-set.schema.json",
  ]);
  for (const [name, schema] of Object.entries(schemas))
    assert.ok(schema.description, `${name} has a root description`);
  const project = schemas["agent-profile.project.schema.json"]!;
  assert.deepEqual(project.required?.[0], "version");
  assert.ok(project.properties?.["version"]);
  assert.ok(
    !schemas["agent-profile.user.schema.json"]!.properties?.["version"],
  );
  assert.deepEqual(
    (
      schemas["agent-preferences.project.schema.json"]!.properties?.[
        "version"
      ] as { const?: number }
    ).const,
    2,
  );
  // Defaults are optional in the input shape.
  const launch = JSON.stringify(schemas["launch-definitions.schema.json"]);
  assert.match(launch, /"runPolicy"/);
  const definitions = schemas["launch-definitions.schema.json"]!.properties![
    "definitions"
  ] as { items: { required: string[] } };
  assert.ok(!definitions.items.required.includes("runPolicy"));
});

test("writes schemas and public declarations into the skill folder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-reference-"));
  try {
    await writeSkillReferenceAssets(dir);
    const reference = join(dir, "reference");
    const schemas = await readdir(join(reference, "schemas"));
    assert.equal(schemas.length, 8);
    JSON.parse(
      await readFile(
        join(reference, "schemas/permission-rule-set.schema.json"),
        "utf8",
      ),
    );
    const api = join(reference, "extensions/api");
    assert.ok(
      (await readdir(join(api, "extension-api"))).includes("index.d.ts"),
    );
    const sdk = await readdir(join(api, "extension-sdk"), { recursive: true });
    for (const file of [
      "index.d.ts",
      "testing.d.ts",
      "ui.d.ts",
      "ui/host.d.ts",
    ])
      assert.ok(sdk.includes(file), file);
    assert.ok(!sdk.some((file) => file.endsWith(".map")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The prose points at declarations as `Symbol` (`reference/extensions/api/<package>/<file>.d.ts`):
// each pointer must name an export of that generated file, and themes.md must mention every token.
test("declaration pointers in the extension references name exports of the generated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-pointers-"));
  try {
    await writeSkillReferenceAssets(dir);
    const extensions = join(skillSource, "reference", "extensions");
    const files = [
      join(skillSource, "guide", "extensions.md"),
      ...(await readdir(extensions))
        .filter((name) => name.endsWith(".md"))
        .map((name) => join(extensions, name)),
    ];
    let count = 0;
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const [, symbol, path] of text.matchAll(
        /`(\w+)` \(`(reference\/extensions\/api\/extension-(?:api|sdk)\/[\w/-]+\.d\.ts)`\)/g,
      )) {
        const declaration = await readFile(join(dir, path!), "utf8");
        assert.match(
          declaration,
          new RegExp(
            `export (?:declare )?(?:const|function|type|interface|class|let) ${symbol}\\b`,
          ),
          `${file}: ${symbol} is not exported by ${path}`,
        );
        count++;
      }
    }
    assert.ok(count >= 20, `only ${count} pointers found`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("themes.md lists every theme token", async () => {
  const themes = await readFile(
    join(skillSource, "reference/extensions/themes.md"),
    "utf8",
  );
  const missing = themeTokenNames.filter(
    (name) => !themes.includes(`\`${name}`),
  );
  assert.deepEqual(
    missing,
    [],
    `themes.md must mention: ${missing.join(", ")}`,
  );
  assert.ok(themes.includes(`all ${themeTokenNames.length} tokens`));
});

/** Fenced ```json blocks of a reference document. */
async function jsonExamples(file: string): Promise<unknown[]> {
  const text = await readFile(join(skillSource, "reference", file), "utf8");
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match) =>
    JSON.parse(match[1]!),
  );
}

function withoutVersion(value: Record<string, unknown>): unknown {
  const rest = { ...value };
  delete rest["version"];
  return rest;
}

/** Picks the schema of an example by its shape; throws for shapes the test does not know. */
function schemaFor(example: Record<string, unknown>) {
  if ("when" in example && "decision" in example) return permissionRuleSchema;
  if ("overlays" in example) return permissionOverlayDocumentSchema;
  if ("rules" in example) return permissionRuleSetSchema;
  if ("definitions" in example) return launchDefinitionFileSchema;
  if ("whenToUse" in example) return profileDefinitionSchema;
  if ("overrides" in example) return agentPreferencesSchema;
  return undefined;
}

for (const file of ["agent-profiles.md", "permissions.md", "launches.md"]) {
  test(`complete JSON examples in ${file} parse`, async () => {
    let checked = 0;
    for (const example of (await jsonExamples(file)) as Record<
      string,
      unknown
    >[]) {
      const schema = schemaFor(example);
      if (!schema) continue;
      checked += 1;
      // Project files carry an extra top-level `version: 3` (launch files use `version: 2` themselves).
      const value =
        example["version"] === 3 ? withoutVersion(example) : example;
      const result = schema.safeParse(value);
      assert.ok(
        result.success,
        `${file}: ${JSON.stringify(example).slice(0, 80)}… ${result.error?.message}`,
      );
    }
    assert.ok(checked > 0, `${file} has at least one checkable example`);
  });
}
