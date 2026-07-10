import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sandboxConfigV1Schema } from "../src/domains/sandbox/sandbox.config.schema.js";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const schemaPath = path.join(
  packageDir,
  "schemas",
  "sandbox-config-v1.schema.json",
);

function generateSandboxConfigJsonSchema(): string {
  const generated = z.toJSONSchema(sandboxConfigV1Schema, {
    target: "draft-7",
  }) as Record<string, unknown>;

  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://nervekit.dev/schemas/sandbox-config-v1.schema.json",
    title: "Nerve sandbox-agent config v1",
    description:
      "JSON Schema for Nerve sandbox-agent YAML/JSON config. Generated from packages/contracts/src/domains/sandbox/sandbox.config.schema.ts; runtime Zod validation remains authoritative for cross-field hardening rules.",
    ...generated,
  };

  return formatJson(`${JSON.stringify(schema, null, 2)}\n`);
}

function formatJson(content: string): string {
  return execFileSync(
    "pnpm",
    ["exec", "biome", "format", "--stdin-file-path", schemaPath],
    {
      cwd: packageDir,
      encoding: "utf8",
      input: content,
    },
  );
}

async function main(): Promise<void> {
  const expected = generateSandboxConfigJsonSchema();
  if (process.argv.includes("--check")) {
    let actual: string;
    try {
      actual = await readFile(schemaPath, "utf8");
    } catch (error) {
      throw new Error(
        `Missing generated sandbox config schema at ${schemaPath}`,
        {
          cause: error,
        },
      );
    }
    if (actual !== expected) {
      throw new Error(
        `Generated sandbox config schema is stale. Run pnpm --filter @nervekit/contracts schema:generate.`,
      );
    }
    return;
  }

  await mkdir(path.dirname(schemaPath), { recursive: true });
  await writeFile(schemaPath, expected, "utf8");
}

await main();
