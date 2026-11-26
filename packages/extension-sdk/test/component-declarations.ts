// The generated component declarations (`scripts/components-dts.ts`) read through the TypeScript
// checker, for the tests that guard them: `ui-components.test.ts` (documentation, real prop types)
// and `public-surface.test.ts` (the props are surface).
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { generateSdkComponentDeclarations } from "../scripts/components-dts.ts";

const sdkRoot = fileURLToPath(new URL("..", import.meta.url));

export type ComponentInfo = {
  /** Export name; parts of a multi-part component are `Tabs.List`. */
  name: string;
  /** Declared in the UI kit or SDK sources (not re-exported from a library such as `paneforge`). */
  own: boolean;
  /** Has a component-level doc comment. */
  documented: boolean;
  /** Props declared in the UI kit or SDK sources (native element attributes and library props are not listed), `name: type`; `optional` marks `name?`. */
  props: {
    name: string;
    optional: boolean;
    type: string;
    documented: boolean;
  }[];
};

export type ComponentDeclarations = {
  /** Components (values with a props parameter) of `components.d.ts`. */
  components: ComponentInfo[];
  /** Other value exports (`cn`, `buttonVariants`, …) with their doc state and signature. */
  functions: { name: string; documented: boolean; signature: string }[];
  /** Exported types, expanded. */
  types: { name: string; documented: boolean; text: string }[];
  /** Export names, sorted. */
  exports: string[];
};

export type GeneratedComponents = {
  /** Folder that holds `components/` (so it can stand next to `src/` as a root directory). */
  root: string;
  /** The emitted files, relative to `<root>/components`. */
  files: string[];
  /** The declarations as the checker reads them. */
  declarations: ComponentDeclarations;
};

let shared: Promise<GeneratedComponents> | undefined;

/**
 * Generates the declarations into a scratch folder inside the package (so `svelte`, `bits-ui` and
 * the other libraries they import resolve) and hands them to `use`. The generation (svelte2tsx and
 * the declaration emit of ~100 components) runs once per test process and is shared by every
 * caller, which treat it as read-only; the folder is removed when the process exits.
 */
export async function withGeneratedComponents<T>(
  use: (generated: GeneratedComponents) => T | Promise<T>,
): Promise<T> {
  shared ??= (async () => {
    const root = await mkdtemp(join(sdkRoot, ".components-"));
    process.once("exit", () => rmSync(root, { recursive: true, force: true }));
    const files = await generateSdkComponentDeclarations(
      join(root, "components"),
    );
    const declarations = read(join(root, "components", "components.d.ts"));
    return { root, files, declarations };
  })();
  return use(await shared);
}

function read(entry: string): ComponentDeclarations {
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry)!;
  const scratch = entry.slice(0, entry.lastIndexOf("/"));
  /** Declared in the generated tree: the UI kit's and the SDK's own sources. */
  const own = (declaration: ts.Declaration) => {
    const file = declaration.getSourceFile().fileName;
    return file.startsWith(scratch) && !file.includes("node_modules");
  };
  const docOf = (symbol: ts.Symbol) =>
    ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim() !==
    "";
  const resolved = (symbol: ts.Symbol) =>
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;

  const result: ComponentDeclarations = {
    components: [],
    functions: [],
    types: [],
    exports: [],
  };

  function visit(name: string, exported: ts.Symbol) {
    const symbol = resolved(exported);
    // `export * as Tabs`: each part.
    if (
      symbol.flags & ts.SymbolFlags.ValueModule &&
      symbol.exports &&
      !(symbol.flags & ts.SymbolFlags.Function)
    ) {
      for (const [part, partSymbol] of symbol.exports)
        if (part !== "default") visit(`${name}.${part}`, partSymbol);
      return;
    }
    result.exports.push(name);
    const declaration = symbol.declarations?.[0];
    if (!declaration) return;
    if (!(symbol.flags & ts.SymbolFlags.Value)) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      result.types.push({
        name,
        documented: docOf(symbol),
        text: checker.typeToString(
          type,
          undefined,
          ts.TypeFormatFlags.NoTruncation |
            ts.TypeFormatFlags.InTypeAlias |
            ts.TypeFormatFlags.MultilineObjectLiterals,
        ),
      });
      return;
    }
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const signature = type.getCallSignatures()[0];
    // A Svelte component is `Component<Props>` (`(internals, props)`) or a generic constructor-like
    // with the same call signature; the props are the last parameter.
    const isComponent =
      signature !== undefined &&
      /^[A-Z]/.test(name.split(".").pop()!) &&
      signature.getParameters().length >= 2;
    if (!isComponent) {
      result.functions.push({
        name,
        documented: docOf(symbol),
        signature: signature ? checker.signatureToString(signature) : "",
      });
      return;
    }
    const parameters = signature.getParameters();
    const propsSymbol = parameters[parameters.length - 1]!;
    const propsType = checker.getTypeOfSymbolAtLocation(
      propsSymbol,
      declaration,
    );
    const props = propsType
      .getProperties()
      .filter((prop) => prop.declarations?.some(own))
      .map((prop) => ({
        name: prop.name,
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
        type: checker.typeToString(
          checker.getTypeOfSymbolAtLocation(prop, declaration),
          undefined,
          ts.TypeFormatFlags.NoTruncation,
        ),
        documented: docOf(prop),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    result.components.push({
      name,
      own: own(declaration),
      documented: docOf(symbol),
      props,
    });
  }

  for (const symbol of checker.getExportsOfModule(
    checker.getSymbolAtLocation(source)!,
  ))
    visit(symbol.name, symbol);
  result.exports.sort();
  return result;
}
