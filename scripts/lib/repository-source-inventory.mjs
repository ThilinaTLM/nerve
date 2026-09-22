import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { parse as parseSvelte } from "svelte/compiler";
import ts from "typescript";

export const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte)$/;

export function analyzeImports(text, file = "source.ts") {
  const values = new Set();
  const nonLiteralDynamicImports = [];
  const scripts = file.endsWith(".svelte")
    ? svelteScripts(text, file)
    : [{ text, offset: 0 }];
  for (const script of scripts) {
    analyzeScript(
      script.text,
      file,
      script.offset,
      values,
      nonLiteralDynamicImports,
    );
  }
  return { specifiers: values, nonLiteralDynamicImports };
}

export function importSpecifiers(text, file) {
  return analyzeImports(text, file).specifiers;
}

function analyzeScript(text, file, offset, values, nonLiteralDynamicImports) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  visit(source);

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      values.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      values.add(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) {
          values.add(argument.text);
        } else if (isDynamicImport) {
          const position = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          nonLiteralDynamicImports.push({
            file,
            line: position.line + 1,
            column: position.character + 1,
            offset: offset + node.getStart(source),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
}

function svelteScripts(text, file) {
  let component;
  try {
    component = parseSvelte(text, { filename: file, modern: true });
  } catch (error) {
    throw new Error(`Could not parse ${file} for architecture checks.`, {
      cause: error,
    });
  }
  return [component.module, component.instance]
    .filter(Boolean)
    .map((script) => ({
      text: text.slice(script.content.start, script.content.end),
      offset: script.content.start,
    }));
}

function scriptKind(file) {
  if (/\.[cm]?tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function resolvedImportPath(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

/** One inventory of tracked and non-ignored untracked source files, excluding deleted paths. */
export function createRepositorySourceInventory(repoRoot) {
  const contents = new Map();
  const files = trackedRepositoryFiles();
  return { repoRoot, files, read };

  function trackedRepositoryFiles() {
    const result = spawnSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`git ls-files failed with exit code ${result.status}`);
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .map((path) => path.split(sep).join("/"))
      .filter((path) => existsSync(join(repoRoot, path)))
      .sort();
  }

  function read(file) {
    if (!contents.has(file))
      contents.set(file, readFileSync(join(repoRoot, file), "utf8"));
    return contents.get(file);
  }
}
