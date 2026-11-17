import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build as esbuild, type Message, type Plugin } from "esbuild";
import * as api from "@nervekit/extension-api";
import {
  extensionDefinitionData,
  type ExtensionDefinition,
  type ExtensionDefinitionData,
} from "@nervekit/extension-api";
import { installedExtensionManifestSchema } from "@nervekit/contracts/extensions";
import { ExtensionProjectError, type Problem } from "./problems.js";

/** What `dist/manifest.json` holds: the definition's plain data plus the two versions. */
export type BuiltManifest = ExtensionDefinitionData & {
  version: string;
  sdkVersion: string;
};

export type BuildOptions = {
  /** The extension folder (holds `package.json` and `src/extension.ts`). */
  projectDir: string;
};

export type BuildResult = {
  manifest: BuiltManifest;
  /** Absolute path of `dist/`. */
  distDir: string;
};

/** Limits the host enforces when it reads `dist/`; checking them here fails the build, not the install. */
const maxBackendBytes = 8 * 1024 * 1024;
const maxManifestBytes = 1024 * 1024;
const maxDocBytes = 256 * 1024;
const maxIconBytes = 16 * 1024;

/** The SDK's own version, written to the manifest as `sdkVersion`. */
export async function sdkVersion(): Promise<string> {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  return (JSON.parse(await readFile(file, "utf8")) as { version: string })
    .version;
}

const runtimeApiModule = "nerve-extension-api-runtime";

/** `@nervekit/extension-api` (and the SDK's re-export of it) is the runtime's global, not part of the bundle. */
function runtimeApiPlugin(): Plugin {
  return {
    name: "extension-api-from-runtime",
    setup(builder) {
      builder.onResolve({ filter: /^@nervekit\/extension-(api|sdk)$/ }, () => ({
        path: "extension-api",
        namespace: runtimeApiModule,
      }));
      builder.onResolve(
        { filter: /^@nervekit\/extension-(api|sdk)\/testing$/ },
        (args) => ({
          errors: [
            {
              text: `'${args.path}' holds test helpers (Vitest and the fake ctx) and cannot be part of the backend. Import it only from files under test/.`,
            },
          ],
        }),
      );
      builder.onResolve(
        { filter: /^@nervekit\/(extension-sdk\/ui|ui-kit)(\/|$)/ },
        (args) => ({
          errors: [
            {
              text: `'${args.path}' is UI code and cannot be imported by the backend (src/extension.ts and what it imports).`,
            },
          ],
        }),
      );
      builder.onLoad({ filter: /.*/, namespace: runtimeApiModule }, () => ({
        contents: "module.exports = globalThis.__nerveExtensionApi;",
        loader: "js",
      }));
    },
  };
}

function esbuildProblems(messages: Message[], projectDir: string): Problem[] {
  return messages.map((message) => {
    const location = message.location;
    const where = location
      ? `${location.file.startsWith("/") ? location.file : join(projectDir, location.file)}:${location.line}:${location.column + 1}`
      : "src/extension.ts";
    const text = message.text;
    const unresolved = /^Could not resolve "(.+)"$/.exec(text);
    return {
      what: text,
      where,
      fix: unresolved
        ? `The backend runs in a sandbox with no Node.js built-ins and only what is bundled. Install '${unresolved[1]}' as a dependency if it is a browser-safe package, or remove the import.`
        : "Fix the code at that location; the backend must be plain TypeScript that runs in a sandbox without Node.js APIs.",
    };
  });
}

async function readProjectJson(
  projectDir: string,
): Promise<{ id: string; version: string }> {
  const file = join(projectDir, "package.json");
  let json: { version?: unknown };
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (cause) {
    throw new ExtensionProjectError({
      what: `Cannot read package.json: ${cause instanceof Error ? cause.message : String(cause)}`,
      where: file,
      fix: "Run nerve-ext from the extension folder (the one holding package.json), or create the project with `nerve-ext init <id> --kind <kind>`.",
    });
  }
  if (typeof json.version !== "string")
    throw new ExtensionProjectError({
      what: 'package.json has no "version".',
      where: file,
      fix: 'Add "version": "0.1.0". It becomes the extension version in dist/manifest.json.',
    });
  return { id: basename(projectDir), version: json.version };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** The path stays inside `root`: relative, no `..`. */
function insideProject(path: string): boolean {
  return (
    !isAbsolute(path) && !path.split(/[\\/]/).includes("..") && path.length > 0
  );
}

/** Evaluates the bundle the way the host's sandbox does and returns what it registered. */
function evaluateDefinition(bundle: string): ExtensionDefinition {
  const sandbox = createContext({ console });
  (sandbox as { __nerveExtensionApi?: unknown }).__nerveExtensionApi = api;
  try {
    runInContext(bundle, sandbox, { timeout: 5000, filename: "backend.js" });
  } catch (cause) {
    throw new ExtensionProjectError({
      what: `src/extension.ts failed while loading: ${cause instanceof Error ? cause.message : String(cause)}`,
      where: "src/extension.ts (top level, evaluated by nerve-ext build)",
      fix: "The definition is evaluated once at build time and again when the host loads the backend. Keep the top level free of side effects and of anything that needs Node.js or the network.",
    });
  }
  const definition = (sandbox as { __nerveExtension?: unknown })
    .__nerveExtension;
  if (definition === null || typeof definition !== "object")
    throw new ExtensionProjectError({
      what: "src/extension.ts has no default export.",
      where: "src/extension.ts",
      fix: 'Export the definition: `export default defineExtension({ id: "...", ... });` with defineExtension imported from "@nervekit/extension-sdk".',
    });
  return definition as ExtensionDefinition;
}

/** Zod issues as problems: the path says which field of the definition is wrong. */
function manifestProblems(
  issues: readonly {
    path: PropertyKey[];
    message: string;
    code: string;
    keys?: string[];
  }[],
): Problem[] {
  return issues.map((issue) => {
    const path = issue.path
      .map((part, index) =>
        typeof part === "number"
          ? `[${part}]`
          : `${index ? "." : ""}${String(part)}`,
      )
      .join("");
    const unknownKeys =
      issue.code === "unrecognized_keys" ? issue.keys : undefined;
    const field = unknownKeys
      ? `${path ? `${path}.` : ""}${unknownKeys.join(", ")}`
      : path || "(definition)";
    const unsupported = unknownKeys?.includes("prelude")
      ? "Installed extensions cannot add helper code to the script sandbox; remove `prelude`."
      : undefined;
    return {
      what: unknownKeys
        ? `Unknown field ${field} in the extension definition.`
        : `Invalid ${field}: ${issue.message}`,
      where: `src/extension.ts, defineExtension({...}) at ${field}`,
      fix:
        unsupported ??
        (unknownKeys
          ? "Remove or rename the field; installed extensions accept only the documented definition fields."
          : "Change the value in the definition so it matches the field's type."),
    };
  });
}

/** Checks the files the manifest points at and copies them into `dist/`. */
async function copyAssets(
  projectDir: string,
  distDir: string,
  manifest: BuiltManifest,
): Promise<void> {
  const problems: Problem[] = [];
  if (await exists(join(projectDir, "docs")))
    await cp(join(projectDir, "docs"), join(distDir, "docs"), {
      recursive: true,
    });
  if (manifest.icon.endsWith(".svg")) {
    const source = join(projectDir, manifest.icon);
    if (!insideProject(manifest.icon) || !(await exists(source)))
      problems.push({
        what: `The icon file '${manifest.icon}' does not exist.`,
        where: `src/extension.ts: icon: ${JSON.stringify(manifest.icon)}`,
        fix: `Create ${manifest.icon} in the extension folder (a square SVG up to 16 KB), or use a lucide icon name such as "blocks".`,
      });
    else if ((await stat(source)).size > maxIconBytes)
      problems.push({
        what: `The icon file '${manifest.icon}' is larger than ${maxIconBytes} bytes.`,
        where: source,
        fix: "Simplify or optimise the SVG.",
      });
    else {
      await mkdir(dirname(join(distDir, manifest.icon)), { recursive: true });
      await cp(source, join(distDir, manifest.icon));
    }
  }
  for (const namespace of manifest.namespaces)
    for (const topic of namespace.docs ?? []) {
      const file = join(distDir, topic.file);
      if (!insideProject(topic.file) || !(await exists(file)))
        problems.push({
          what: `Doc topic '${topic.id}' points at '${topic.file}', which does not exist.`,
          where: `src/extension.ts: namespace ${namespace.id}, docs[].file`,
          fix: `Create ${topic.file} in the extension folder (the docs/ folder is copied to dist/docs/).`,
        });
      else if ((await stat(file)).size > maxDocBytes)
        problems.push({
          what: `Doc topic file '${topic.file}' is larger than ${maxDocBytes} bytes.`,
          where: join(projectDir, topic.file),
          fix: "Split the topic into smaller topics.",
        });
    }
  if (problems.length > 0) throw new ExtensionProjectError(problems);
}

/**
 * Builds the extension in `projectDir`: bundles `src/extension.ts` into `dist/backend.js` (an
 * IIFE that registers the definition on `globalThis.__nerveExtension`; `@nervekit/extension-api`
 * is the runtime's global, not bundled), evaluates the definition and writes `dist/manifest.json`
 * with the plain data of the definition plus `version` and `sdkVersion`, validated with the
 * schema the host reads it with. Docs topics and the icon are copied into `dist/`.
 */
export async function buildExtension(
  options: BuildOptions,
): Promise<BuildResult> {
  const projectDir = resolve(options.projectDir);
  const distDir = join(projectDir, "dist");
  const project = await readProjectJson(projectDir);
  const entry = join(projectDir, "src", "extension.ts");
  if (!(await exists(entry)))
    throw new ExtensionProjectError({
      what: "src/extension.ts does not exist.",
      where: entry,
      fix: "Create src/extension.ts with `export default defineExtension({...})`, or run nerve-ext from the extension folder.",
    });

  let bundle: string;
  try {
    const result = await esbuild({
      stdin: {
        contents: `import * as entry from "./src/extension.ts";\nglobalThis.__nerveExtension = entry.default;\n`,
        resolveDir: projectDir,
        sourcefile: "nerve-entry.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "iife",
      target: "es2020",
      legalComments: "none",
      logLevel: "silent",
      absWorkingDir: projectDir,
      plugins: [runtimeApiPlugin()],
    });
    bundle = result.outputFiles[0]!.text;
  } catch (cause) {
    const messages = (cause as { errors?: Message[] }).errors;
    if (messages?.length)
      throw new ExtensionProjectError(esbuildProblems(messages, projectDir));
    throw cause;
  }
  if (Buffer.byteLength(bundle) > maxBackendBytes)
    throw new ExtensionProjectError({
      what: `The backend bundle is larger than ${maxBackendBytes} bytes.`,
      where: "dist/backend.js",
      fix: "Remove large dependencies from the backend; the host refuses bundles over 8 MiB.",
    });

  const definition = evaluateDefinition(bundle);
  const data = JSON.parse(
    JSON.stringify(extensionDefinitionData(definition)),
  ) as ExtensionDefinitionData;
  const manifest = {
    ...data,
    version: project.version,
    sdkVersion: await sdkVersion(),
  } as BuiltManifest;

  const parsed = installedExtensionManifestSchema.safeParse(manifest);
  const problems: Problem[] = parsed.success
    ? []
    : manifestProblems(parsed.error.issues as never);
  if (typeof manifest.id === "string" && manifest.id !== project.id)
    problems.push({
      what: `The folder name '${project.id}' must equal the extension id '${manifest.id}'.`,
      where: projectDir,
      fix: `Rename the folder to '${manifest.id}' (Nerve loads an extension only from a folder named like its id), or change the id in src/extension.ts.`,
    });
  const settingsMigrations = (
    definition.settings as { migrations?: unknown } | undefined
  )?.migrations;
  if (settingsMigrations !== undefined)
    problems.push({
      what: "settings.migrations is not available to installed extensions.",
      where: "src/extension.ts: settings.migrations",
      fix: "Remove settings.migrations. Raising settings.version resets stored values for fields that no longer match.",
    });
  if (problems.length > 0) throw new ExtensionProjectError(problems);

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(manifestText) > maxManifestBytes)
    throw new ExtensionProjectError({
      what: `dist/manifest.json would be larger than ${maxManifestBytes} bytes.`,
      where: "src/extension.ts",
      fix: "Shorten the namespace `types` and descriptions, or move text into doc topics (docs/).",
    });

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  try {
    await copyAssets(projectDir, distDir, manifest);
  } catch (cause) {
    await rm(distDir, { recursive: true, force: true });
    throw cause;
  }
  await writeFile(join(distDir, "backend.js"), bundle);
  await writeFile(join(distDir, "manifest.json"), manifestText);
  return { manifest, distDir };
}
