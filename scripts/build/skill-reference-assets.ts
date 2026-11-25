// Build-time reference files of the built-in `configure-nerve` skill. The skill has no Nerve source at
// runtime, so exact shapes ship as generated files instead of prose: JSON Schemas from the zod
// schemas in `packages/contracts` and the public `.d.ts` files of the extension API and SDK.
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { generateSdkComponentDeclarations } from "../../packages/extension-sdk/scripts/components-dts.ts";
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
 * SDK (package boundaries), so its `dist/` is not guaranteed to exist when this runs. The component
 * declarations are generated from the Svelte sources, as the SDK's own build does, and land in
 * `components/`.
 */
async function emitSdkDeclarations(
  sdkDir: string,
): Promise<Map<string, string>> {
  const src = join(sdkDir, "src");
  // Never written: emit goes to the callback below.
  const outDir = join(sdkDir, "declarations");
  const config = ts.getParsedCommandLineOfConfigFile(
    join(sdkDir, "tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!config) throw new Error(`Cannot read ${sdkDir}/tsconfig.json.`);
  // `ui.ts` re-exports `./components/components.js`, which is generated, not part of `src`.
  const generated = await mkdtemp(join(tmpdir(), "sdk-components-"));
  try {
    const componentFiles = await generateSdkComponentDeclarations(
      join(generated, "components"),
    );
    const files = declarationsOf(src, outDir, config, generated);
    for (const file of componentFiles)
      files.set(
        posixPath(join("components", file)),
        await readFile(join(generated, "components", file), "utf8"),
      );
    return files;
  } finally {
    await rm(generated, { recursive: true, force: true });
  }
}

function declarationsOf(
  src: string,
  outDir: string,
  config: ts.ParsedCommandLine,
  generated: string,
): Map<string, string> {
  const options: ts.CompilerOptions = {
    ...config.options,
    rootDirs: [src, generated],
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

const maxLiteralValues = 7;

type CatalogComponent = {
  name: string;
  description: string;
  props: string[];
  /** Declaration file relative to `components/`. */
  file: string;
};

/** Where a component's declaration lives, relative to `components/`: the UI kit's folders name the groups. */
function catalogGroup(file: string): string {
  const match = /^ui-kit\/components\/(ui|composites\/[^/]+)\//.exec(file);
  if (!match) return "sdk";
  return match[1]!.startsWith("ui") ? "ui" : match[1]!;
}

/** First sentence of a doc comment, whole when short. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 200) return flat;
  const end = flat.search(/[.!?](?:\s|$)/);
  return end > 0 && end < 300
    ? flat.slice(0, end + 1)
    : `${flat.slice(0, 197)}…`;
}

/**
 * A compact markdown catalog of what `components/components.d.ts` exports, read from the emitted
 * declarations with the compiler (`resolveRoot`: a directory whose `node_modules` resolve the
 * declarations' packages, such as `svelte`). Components are listed with the doc comment, the props
 * the SDK or UI kit declare (`*` required; short string unions inline) and the declaration file;
 * props inherited from the element or `bits-ui` are not listed.
 */
export function generateComponentCatalog(
  sdk: ReadonlyMap<string, string>,
  resolveRoot: string,
): string {
  const root = join(resolveRoot, "catalog-declarations");
  const virtual = new Map<string, string>();
  for (const [file, text] of sdk)
    if (file.startsWith("components/"))
      virtual.set(posixPath(join(root, file)), text);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile, directoryExists } = host;
  const directories = new Set<string>();
  for (const path of virtual.keys())
    for (let dir = dirname(path); !directories.has(dir); dir = dirname(dir))
      directories.add(dir);
  host.directoryExists = (path) =>
    directories.has(path) || (directoryExists?.(path) ?? false);
  host.fileExists = (path) => virtual.has(path) || fileExists(path);
  host.readFile = (path) => virtual.get(path) ?? readFile(path);
  host.getSourceFile = (path, languageVersion, ...rest) => {
    const text = virtual.get(path);
    return text === undefined
      ? getSourceFile(path, languageVersion, ...rest)
      : ts.createSourceFile(path, text, languageVersion, true);
  };
  const entry = posixPath(join(root, "components/components.d.ts"));
  const program = ts.createProgram([entry], options, host);
  const checker = program.getTypeChecker();
  const indexFile = program.getSourceFile(entry);
  const indexSymbol = indexFile && checker.getSymbolAtLocation(indexFile);
  if (!indexSymbol) throw new Error("components.d.ts has no exports.");

  const relativeFile = (symbol: ts.Symbol) => {
    const source = symbol.declarations?.[0]?.getSourceFile().fileName ?? "";
    return posixPath(relative(root, source));
  };
  const resolve = (symbol: ts.Symbol) =>
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  /** `export default X` resolves to the `declare const X` that carries the doc comment and type. */
  const definition = (symbol: ts.Symbol): ts.Symbol => {
    const declaration = symbol.declarations?.[0];
    if (declaration && ts.isExportAssignment(declaration)) {
      const target = checker.getSymbolAtLocation(declaration.expression);
      if (target) return resolve(target);
    }
    return symbol;
  };
  const component = (
    name: string,
    exported: ts.Symbol,
  ): CatalogComponent | undefined => {
    const symbol = definition(exported);
    const file = relativeFile(exported);
    if (!file.endsWith(".svelte.d.ts") || !symbol.declarations?.[0])
      return undefined;
    const type = checker.getTypeOfSymbolAtLocation(
      symbol,
      symbol.declarations[0],
    );
    const propsParameter = type
      .getCallSignatures()
      .map((signature) => signature.parameters[1])
      .find(Boolean);
    if (!propsParameter) return undefined;
    const props: string[] = [];
    {
      const propsType = checker.getTypeOfSymbolAtLocation(
        propsParameter,
        propsParameter.declarations![0]!,
      );
      for (const prop of checker.getPropertiesOfType(propsType)) {
        // Declared by the SDK or UI kit, not inherited from the element type or a library.
        const origin = prop.declarations?.[0]?.getSourceFile().fileName ?? "";
        if (!virtual.has(origin) || ["class", "children"].includes(prop.name))
          continue;
        const required = !(prop.flags & ts.SymbolFlags.Optional);
        const propType = checker.getTypeOfSymbolAtLocation(
          prop,
          prop.declarations![0]!,
        );
        const members = propType.isUnion()
          ? propType.types.filter(
              (member) => !(member.flags & ts.TypeFlags.Undefined),
            )
          : [propType];
        const literals =
          members.length > 1 &&
          members.length <= maxLiteralValues &&
          members.every((member) => member.isStringLiteral())
            ? `: ${members.map((member) => (member as ts.StringLiteralType).value).join("|")}`
            : "";
        props.push(`${prop.name}${required ? "*" : ""}${literals}`);
      }
    }
    return {
      name,
      description: firstSentence(
        ts.displayPartsToString(symbol.getDocumentationComment(checker)),
      ),
      props,
      file: relativeFile(exported).replace(/^components\//, ""),
    };
  };

  const members = (namespace: ts.Symbol, prefix: string) => {
    const seen = new Set<ts.Symbol>();
    const described: CatalogComponent[] = [];
    for (const member of checker.getExportsOfModule(namespace)) {
      const target = resolve(member);
      if (seen.has(target)) continue;
      seen.add(target);
      const item = component(`${prefix}.${member.name}`, target);
      if (item) described.push(item);
    }
    return described;
  };

  type Entry = {
    name: string;
    item?: CatalogComponent;
    members: CatalogComponent[];
  };
  const grouped = new Map<string, Entry[]>();
  const helpers: string[] = [];
  for (const exported of checker.getExportsOfModule(indexSymbol)) {
    const target = resolve(exported);
    const single = component(exported.name, target);
    const parts = single
      ? []
      : target.flags & ts.SymbolFlags.ValueModule
        ? members(target, exported.name)
        : undefined;
    const first = single ?? parts?.[0];
    if (!first) {
      helpers.push(
        `\`${exported.name}\` (\`${relativeFile(target).replace(/^components\//, "")}\`)`,
      );
      continue;
    }
    const group = catalogGroup(first.file);
    const entry: Entry = {
      name: exported.name,
      item: single,
      members: parts ?? [],
    };
    grouped.set(group, [...(grouped.get(group) ?? []), entry]);
  }
  // A composite family of one component joins `composites`.
  const sections = new Map<string, Entry[]>();
  for (const [group, entries] of grouped) {
    const key =
      group.startsWith("composites/") && entries.length === 1
        ? "composites"
        : group;
    sections.set(key, [...(sections.get(key) ?? []), ...entries]);
  }

  const describe = (item: CatalogComponent) =>
    `${item.description ? ` — ${item.description}` : ""}${
      item.props.length ? ` Props: ${item.props.join(", ")}.` : ""
    } \`${item.file}\``;
  const lines = [
    "# UI components",
    "",
    "Generated from this Nerve version's SDK. Import every component from `@nervekit/extension-sdk/ui`. Exact prop types and per-prop docs are in the linked `.d.ts`; paths are relative to `reference/extensions/api/extension-sdk/components/`. `*` marks a required prop; props are the ones the component declares. Every component also accepts `class`, `children` where it has a body, and its element's native attributes.",
  ];
  for (const [group, entries] of sections) {
    lines.push("", `## ${group}`);
    for (const entry of entries) {
      if (entry.item) lines.push(`- **${entry.name}**${describe(entry.item)}`);
      else {
        lines.push(`- **${entry.name}** (namespace)`);
        for (const member of entry.members)
          lines.push(`  - \`${member.name}\`${describe(member)}`);
      }
    }
  }
  lines.push("", "## Helpers and types", helpers.join(", "));
  return `${lines.join("\n")}\n`;
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

  const sdk = await emitSdkDeclarations(
    join(repoRoot, "packages", "extension-sdk"),
  );
  const missing = [...sdkEntries, "components/components.ts"]
    .map((entry) => entry.replace(/\.ts$/, ".d.ts"))
    .filter((file) => !sdk.has(file));
  if (missing.length)
    throw new Error(`SDK declarations missing: ${missing.join(", ")}.`);
  for (const [file, text] of sdk) {
    const path = join(target, "extension-sdk", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  await writeFile(
    join(reference, "extensions", "components.md"),
    generateComponentCatalog(sdk, join(repoRoot, "packages", "extension-sdk")),
  );
}
