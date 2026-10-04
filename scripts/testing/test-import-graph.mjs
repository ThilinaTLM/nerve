import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

export const isSource = (path) => /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(path);
const opaqueModules =
  /^(?:(?:node:)?(?:fs(?:\/promises)?|child_process|module|worker_threads|vm)|fdir|glob|fast-glob|fs-extra)$/;
const normalize = (path) => path.replaceAll("\\", "/");

export function extractImports(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = new Set();
  const warnings = new Set();
  if (source.parseDiagnostics.length) warnings.add("parse diagnostics");
  function add(expression) {
    if (expression && ts.isStringLiteralLike(expression)) {
      imports.add(expression.text);
      if (opaqueModules.test(expression.text))
        warnings.add(`runtime dependency: ${expression.text}`);
    } else warnings.add("computed module dependency");
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
      else warnings.add("computed type dependency");
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
        add(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression;
        const name = node.expression.name.text;
        if (
          ts.isIdentifier(receiver) &&
          ((receiver.text === "require" && name === "resolve") ||
            (receiver.text === "module" && name === "require"))
        )
          add(node.arguments[0]);
        if (["glob", "globEager", "createRequire"].includes(name))
          warnings.add("runtime module discovery");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { imports: [...imports], warnings: [...warnings] };
}

export function createImportGraph(root, files, workspace) {
  const inventory = new Set(files);
  const configs = new Map();
  const manifests = new Map();
  for (const [name, pkg] of workspace) {
    const directory = resolve(root, pkg.directory);
    manifests.set(
      name,
      JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")),
    );
    const configFile = resolve(directory, "tsconfig.json");
    let options = {};
    if (existsSync(configFile)) {
      const config = ts.readConfigFile(configFile, ts.sys.readFile);
      if (config.error) throw new Error(`Cannot read ${configFile}`);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        directory,
      );
      // Empty synthetic projects are valid for selection; other diagnostics aren't.
      if (parsed.errors.some((error) => error.code !== 18003))
        throw new Error(`Cannot resolve ${configFile}`);
      options = parsed.options;
    }
    configs.set(name, options);
  }
  function owner(file) {
    return [...workspace].find(([, pkg]) =>
      file.startsWith(`${pkg.directory}/`),
    )?.[0];
  }
  function sourcePath(absolute) {
    let path = normalize(relative(root, absolute));
    const name = owner(path);
    const options = configs.get(name);
    if (options?.outDir && options.rootDir) {
      const output = normalize(relative(root, options.outDir));
      if (path.startsWith(`${output}/`))
        path =
          normalize(relative(root, options.rootDir)) +
          path.slice(output.length);
    }
    const stem = path.replace(/(?:\.d)?\.(?:[cm]?[jt]s|[jt]sx)$/, "");
    const extensions = [
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ];
    let candidates;
    if (/\.(?:d\.)?m[jt]s$/.test(path))
      candidates = [`${stem}.mts`, `${stem}.mjs`];
    else if (/\.(?:d\.)?c[jt]s$/.test(path))
      candidates = [`${stem}.cts`, `${stem}.cjs`];
    else if (/\.(?:d\.)?[jt]sx?$/.test(path))
      candidates = [
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.js`,
        `${stem}.jsx`,
        path,
      ];
    else
      candidates = [
        path,
        ...extensions.map((suffix) => path + suffix),
        ...extensions.map((suffix) => `${path}/index${suffix}`),
      ];
    return candidates.find((candidate) => inventory.has(candidate));
  }
  function exportTargets(value) {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.values(value).flatMap(exportTargets);
  }
  function dependency(specifier, file) {
    const packageName = [...workspace.keys()].find(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    );
    if (packageName) {
      const manifest = manifests.get(packageName);
      const subpath =
        specifier === packageName
          ? "."
          : `.${specifier.slice(packageName.length)}`;
      const exports = manifest.exports;
      let target;
      let wildcard;
      if (
        typeof exports === "string" ||
        (exports && !Object.keys(exports).some((key) => key.startsWith(".")))
      ) {
        if (subpath === ".") target = exports;
      } else {
        target = exports?.[subpath];
        if (!target) {
          const keys = Object.keys(exports ?? {})
            .filter((key) => key.includes("*"))
            .sort((a, b) => b.length - a.length);
          for (const key of keys) {
            const [prefix, suffix] = key.split("*");
            if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
              wildcard = subpath.slice(
                prefix.length,
                suffix ? -suffix.length : undefined,
              );
              target = exports[key];
              break;
            }
          }
        }
      }
      const targets = exportTargets(target).map((path) =>
        sourcePath(
          resolve(
            root,
            workspace.get(packageName).directory,
            path.replaceAll("*", wildcard ?? ""),
          ),
        ),
      );
      const unique = [...new Set(targets.filter(Boolean))];
      if (targets.length && targets.every(Boolean) && unique.length === 1)
        return { path: unique[0] };
      return { warning: `unresolved workspace import: ${specifier}` };
    }
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
      const path = sourcePath(resolve(root, dirname(file), specifier));
      return path
        ? { path }
        : { warning: `unresolved local import: ${specifier}` };
    }
    const options = configs.get(owner(file)) ?? {};
    const result = ts.resolveModuleName(
      specifier,
      resolve(root, file),
      options,
      ts.sys,
    ).resolvedModule;
    if (
      result &&
      !normalize(result.resolvedFileName).includes("/node_modules/")
    ) {
      const path = sourcePath(result.resolvedFileName);
      return path
        ? { path }
        : { warning: `unresolved source import: ${specifier}` };
    }
    if (
      specifier.startsWith("$") ||
      Object.keys(options.paths ?? {}).some((key) =>
        specifier.startsWith(key.split("*")[0]),
      )
    ) {
      return { warning: `unresolved alias: ${specifier}` };
    }
    return {}; // External dependencies are opaque implementations, not graph inputs.
  }
  const nodes = new Map();
  function load(file) {
    if (nodes.has(file)) return;
    const node = { dependencies: [], warnings: [] };
    nodes.set(file, node);
    if (!isSource(file)) {
      node.warnings.push(`unsupported module: ${extname(file)}`);
      return;
    }
    const parsed = extractImports(
      readFileSync(resolve(root, file), "utf8"),
      file,
    );
    node.warnings.push(...parsed.warnings);
    for (const specifier of parsed.imports) {
      const result = dependency(specifier, file);
      if (result.warning) node.warnings.push(result.warning);
      if (result.path) {
        node.dependencies.push(result.path);
        load(result.path);
      }
    }
  }
  function trace(test) {
    load(test);
    const chains = new Map();
    const warnings = [];
    function visit(file, chain) {
      if (chains.has(file)) return;
      chains.set(file, chain);
      for (const warning of nodes.get(file).warnings)
        warnings.push(`${file}: ${warning}`);
      for (const next of nodes.get(file).dependencies)
        visit(next, [...chain, next]);
    }
    visit(test, [test]);
    return { chains, warnings };
  }
  return { trace };
}
