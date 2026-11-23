// Declarations of the components `src/components/components.impl.ts` exports, generated from their
// Svelte sources (svelte2tsx + the TypeScript declaration emitter): every component keeps its real
// prop types and the JSDoc on its props, and helper types come from the module that defines them.
//
// Output (`outDir`, `dist/components`): `components.d.ts` for the implementation, the SDK's own
// modules next to it and the UI kit's modules under `ui-kit/`, one `.d.ts` per reachable module.
// Specifiers of the UI kit become relative paths, so the published types need nothing but the
// SDK's own dependencies (`svelte`, `bits-ui`, …) to resolve.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { svelte2tsx } from "svelte2tsx";
import ts from "typescript";

const require = createRequire(import.meta.url);
const svelteVersion = JSON.parse(
  await readFile(require.resolve("svelte/package.json"), "utf8"),
).version;

/** Ambient helpers the svelte2tsx output calls. */
const shims = require.resolve("svelte2tsx/svelte-shims-v4.d.ts");

/** A `.svelte` source is seen as the TypeScript file `<name>.svelte.virtual.ts` holding its svelte2tsx output. */
const virtualSuffix = ".virtual.ts";
const isSvelte = (path: string) => path.endsWith(".svelte");
const isVirtual = (path: string) => path.endsWith(`.svelte${virtualSuffix}`);
const real = (path: string) =>
  isVirtual(path) ? path.slice(0, -virtualSuffix.length) : path;

type Config = {
  /** The implementation module (`components.impl.ts`). */
  entry: string;
  outDir: string;
  /** Real path of the UI kit's `src/lib`. */
  uiKitRoot: string;
  /** The SDK's `src/components`. */
  sdkRoot: string;
};

/** Generates the declarations; resolves with the emitted files, relative to `outDir`. */
export async function generateComponentDeclarations(
  config: Config,
): Promise<string[]> {
  const { entry, outDir, uiKitRoot, sdkRoot } = config;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
    noCheck: true,
    isolatedDeclarations: false,
    allowNonTsExtensions: true,
    types: [],
    outDir: "/virtual",
  };

  const transformed = new Map<string, string>();
  const sys: ts.System = {
    ...ts.sys,
    fileExists(path: string) {
      if (isVirtual(path)) return ts.sys.fileExists(real(path));
      return ts.sys.fileExists(path) && !isSvelte(path);
    },
    readFile(path: string, encoding?: string) {
      if (!isVirtual(path)) return ts.sys.readFile(path, encoding);
      const file = real(path);
      let output = transformed.get(file);
      if (output === undefined) {
        const source = ts.sys.readFile(file, "utf8");
        if (source === undefined) return undefined;
        output = svelte2tsx(source, {
          filename: file,
          isTsFile: /<script[^>]*lang=["']ts["']/.test(source),
          mode: "dts",
          version: svelteVersion,
          // Not in the published types of svelte2tsx; it drops the Svelte 4 base class from the output.
          noSvelteComponentTyped: true,
        } as Parameters<typeof svelte2tsx>[1]).code;
        transformed.set(file, output);
      }
      return output;
    },
  };

  /** Resolves like the bundler, with a `.svelte` file as its virtual TypeScript twin. */
  const resolveName = (
    name: string,
    containingFile: string,
  ): ts.ResolvedModuleFull | undefined => {
    const from = real(containingFile);
    const file = name.startsWith(".")
      ? resolve(dirname(from), name)
      : undefined;
    if (file && isSvelte(file) && ts.sys.fileExists(file))
      return {
        resolvedFileName: `${file}${virtualSuffix}`,
        extension: ts.Extension.Ts,
      };
    const resolved = ts.resolveModuleName(
      name,
      from,
      options,
      sys,
    ).resolvedModule;
    if (!resolved) return undefined;
    // The UI kit is emitted like the SDK's own sources, not treated as a library.
    const own = place(resolved.resolvedFileName) !== undefined;
    return {
      ...resolved,
      ...(isSvelte(resolved.resolvedFileName)
        ? {
            resolvedFileName: `${resolved.resolvedFileName}${virtualSuffix}`,
            extension: ts.Extension.Ts,
          }
        : {}),
      isExternalLibraryImport: own ? false : resolved.isExternalLibraryImport,
    };
  };

  const host = ts.createCompilerHost(options);
  host.fileExists = (path: string) => sys.fileExists(path);
  host.readFile = (path: string) => sys.readFile(path);
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal: { text: string }) => ({
      resolvedModule: resolveName(literal.text, containingFile),
    }));

  /** Where the declaration of a source module lands under `outDir`; undefined for modules outside the SDK and the UI kit. */
  const place = (source: string): string | undefined => {
    const file = real(source);
    if (file === entry) return "components.d.ts";
    const stem = (path: string) =>
      isSvelte(path) ? `${path}.d.ts` : path.replace(/\.(ts|js)$/, ".d.ts");
    if (file.startsWith(sdkRoot + sep)) return stem(relative(sdkRoot, file));
    if (file.startsWith(uiKitRoot + sep))
      return stem(join("ui-kit", relative(uiKitRoot, file)));
    return undefined;
  };

  const program = ts.createProgram([entry, shims], options, host);
  const emitted = new Map<string, string>();
  for (const sourceFile of program.getSourceFiles())
    if (place(sourceFile.fileName))
      program.emit(
        sourceFile,
        (name, text, _bom, _onError, sources) => {
          if (name.endsWith(".d.ts") && sources?.[0])
            emitted.set(sources[0].fileName, text);
        },
        undefined,
        true,
      );

  await rm(outDir, { recursive: true, force: true });
  const files: string[] = [];
  for (const [sourceName, text] of emitted) {
    const target = place(sourceName)!;
    const rewritten = text.replace(
      /(\bfrom\s+|\bimport\()(["'])([^"']+)\2/g,
      (match: string, lead: string, quote: string, specifier: string) => {
        if (specifier.startsWith(".")) return match;
        const resolved = resolveName(specifier, sourceName);
        const to = resolved && place(resolved.resolvedFileName);
        if (!to) return match;
        let path = relative(dirname(target), to)
          .split(sep)
          .join("/")
          .replace(/(\.svelte)\.d\.ts$/, "$1")
          .replace(/\.d\.ts$/, ".js");
        if (!path.startsWith(".")) path = `./${path}`;
        return `${lead}${quote}${path}${quote}`;
      },
    );
    const path = join(outDir, target);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rewritten);
    files.push(target);
  }
  return files.sort();
}

/** The SDK's own entry: generates `dist/components` (what `pnpm build` and `pnpm check` run first). */
export async function generateSdkComponentDeclarations(
  outDir = fileURLToPath(new URL("../dist/components", import.meta.url)),
): Promise<string[]> {
  const sdkRoot = fileURLToPath(new URL("../src/components", import.meta.url));
  // `src/lib/index.ts` of the UI kit, through the workspace link.
  const uiKitRoot = dirname(realpathSync(require.resolve("@nervekit/ui-kit")));
  return generateComponentDeclarations({
    entry: join(sdkRoot, "components.impl.ts"),
    outDir,
    uiKitRoot,
    sdkRoot,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await generateSdkComponentDeclarations();
