// Build-time reference files of the built-in `configure-nerve` skill. The skill has no Nerve source at
// runtime, so exact shapes ship as generated files instead of prose: JSON Schemas from the zod
// schemas in `packages/contracts` and the public `.d.ts` files of the extension API and SDK.
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import {
  agentPreferencesSchema,
  profileDefinitionSchema,
} from "../../packages/contracts/src/domains/agent-configuration/schemas.ts";
import { launchDefinitionFileSchema } from "../../packages/contracts/src/domains/launch-definitions/launch-definition.ts";
import {
  permissionOverlayDocumentSchema,
  permissionRuleSetSchema,
} from "../../packages/contracts/src/domains/permissions/permission-rule-sets.ts";
import { repoRoot } from "../workspace/repo.ts";

type JsonSchema = Record<string, unknown> & {
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
};

/** Shared parts become `$defs` so a document repeats nothing. */
function inputSchema(schema: z.ZodType, note: string): JsonSchema {
  const json = z.toJSONSchema(schema, {
    io: "input",
    reused: "ref",
  }) as JsonSchema;
  return {
    ...json,
    description: [json.description, note].filter(Boolean).join(" "),
  };
}

/** Project files carry a top-level `version` of their own; a note says so instead of a second file. */
const projectVersion = (version: number) =>
  `A project file also has a top-level \`"version": ${version}\`; a user file has none.`;

/** File name (without directory) to JSON Schema of each on-disk configuration document. */
export function generateConfigurationSchemas(): Record<string, JsonSchema> {
  return {
    "agent-profile.schema.json": inputSchema(
      profileDefinitionSchema,
      `Agent profile file. ${projectVersion(3)} A project profile needs the user's approval before it is used.`,
    ),
    "agent-preferences.schema.json": inputSchema(
      agentPreferencesSchema,
      `\`<home>/config/agent.json\` and \`<project>/.nerve/config/agent.json\`. ${projectVersion(2)}`,
    ),
    "permission-rule-set.schema.json": inputSchema(
      permissionRuleSetSchema,
      "One rule set file in `<home>/config/permission-rule-sets/`.",
    ),
    "permission-overlays.schema.json": inputSchema(
      permissionOverlayDocumentSchema,
      `\`<home>/config/permissions.json\` and \`<project>/.nerve/config/permissions.json\`. ${projectVersion(3)} In a project file every rule must be \`overridable\`, and an \`allow\` rule may not match the \`nerve_home\` or \`nerve_data\` roots.`,
    ),
    "launch-definitions.schema.json": inputSchema(
      launchDefinitionFileSchema,
      "`<project>/.nerve/launches/definitions.json`.",
    ),
  };
}

async function declarationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

/** Map keys are compared with `/`-separated names, also on Windows. */
const posixPath = (path: string) => path.split(sep).join("/");

async function copyDeclarations(
  from: string,
  to: string,
  files: readonly string[],
): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(join(to, file)), { recursive: true });
    await cp(join(from, file), join(to, file));
  }
}

const sdkEntries = ["index.ts", "testing.ts", "ui.ts"];

/**
 * The SDK's public declarations, emitted from its sources: the workbench server may not depend on the
 * SDK (package boundaries), so its `dist/` is not guaranteed to exist when this runs. Hand-written
 * `.d.ts` sources (the UI components) are copied as they are, as the SDK's own build does.
 */
function emitSdkDeclarations(sdkDir: string): Map<string, string> {
  const src = join(sdkDir, "src");
  // Never written: emit goes to the callback below.
  const outDir = join(sdkDir, "declarations");
  const config = ts.getParsedCommandLineOfConfigFile(
    join(sdkDir, "tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!config) throw new Error(`Cannot read ${sdkDir}/tsconfig.json.`);
  const options: ts.CompilerOptions = {
    ...config.options,
    composite: false,
    incremental: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    noEmitOnError: false,
    outDir,
    rootDir: src,
  };
  const program = ts.createProgram(
    sdkEntries.map((entry) => join(src, entry)),
    options,
  );
  const files = new Map<string, string>();
  program.emit(undefined, (fileName, text) => {
    files.set(posixPath(relative(outDir, fileName)), text);
  });
  for (const source of program.getSourceFiles())
    if (source.isDeclarationFile) {
      // TypeScript reports forward-slash paths on every platform; `relative` accepts both.
      const path = relative(src, source.fileName);
      if (!path.startsWith("..") && !isAbsolute(path))
        files.set(posixPath(path), source.text);
    }
  return files;
}

/**
 * Writes `reference/schemas/*.schema.json` and the public `.d.ts` files of the extension API and SDK
 * into `<skill>/reference`. The extension API is a dependency of the workbench server, so its `dist/` is
 * built first; the SDK's declarations are emitted from its sources.
 */
export async function writeSkillReferenceAssets(
  skillDir: string,
): Promise<void> {
  const reference = join(skillDir, "reference");
  const schemas = join(reference, "schemas");
  await mkdir(schemas, { recursive: true });
  for (const [name, schema] of Object.entries(generateConfigurationSchemas()))
    await writeFile(join(schemas, name), `${JSON.stringify(schema)}\n`);

  const api = join(repoRoot, "packages", "extension-api", "dist");
  const apiFiles = await declarationFiles(api).catch((): string[] => []);
  if (!apiFiles.includes("index.d.ts"))
    throw new Error(
      `${api} has no declarations; build @nervekit/extension-api first.`,
    );
  const target = join(reference, "extensions", "api");
  // `host` and what only it exports are for the host, not for authors.
  const hostOnly = ["host.d.ts", "data.d.ts", "options.d.ts"];
  await copyDeclarations(
    api,
    join(target, "extension-api"),
    apiFiles.filter((file) => !hostOnly.includes(file)),
  );

  const sdk = emitSdkDeclarations(join(repoRoot, "packages", "extension-sdk"));
  const missing = [...sdkEntries, "ui/components.ts"]
    .map((entry) => entry.replace(/\.ts$/, ".d.ts"))
    .filter((file) => !sdk.has(file));
  if (missing.length)
    throw new Error(`SDK declarations missing: ${missing.join(", ")}.`);
  for (const [file, text] of sdk) {
    const path = join(target, "extension-sdk", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
}
