import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const domains = new Set(["git", "monitor", "process", "search"]);

// Small lexical mask, not a Rust parser: nested comments, ordinary/raw/byte strings,
// and character literals cannot introduce fake paths or hide following real ones.
function rustCode(source) {
  let out = "",
    i = 0;
  const mask = (end) => {
    out += source.slice(i, end).replace(/[^\n]/g, " ");
    i = end;
  };
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      mask(end < 0 ? source.length : end);
      continue;
    }
    if (source.startsWith("/*", i)) {
      let end = i + 2,
        depth = 1;
      while (end < source.length && depth) {
        if (source.startsWith("/*", end)) {
          depth++;
          end += 2;
        } else if (source.startsWith("*/", end)) {
          depth--;
          end += 2;
        } else end++;
      }
      mask(end);
      continue;
    }
    const raw = /^(?:br|r)(#*)"/.exec(source.slice(i));
    if (raw) {
      const end = source.indexOf('"' + raw[1], i + raw[0].length);
      mask(end < 0 ? source.length : end + 1 + raw[1].length);
      continue;
    }
    if (source[i] === '"') {
      let end = i + 1;
      while (end < source.length) {
        if (source[end] === "\\") end += 2;
        else if (source[end++] === '"') break;
      }
      mask(end);
      continue;
    }
    const character =
      /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'/u.exec(
        source.slice(i),
      );
    if (character) {
      mask(i + character[0].length);
      continue;
    }
    out += source[i++];
  }
  return out;
}

/** Check source strings as well as the real tree so forbidden edges have unit coverage. */
export function checkSource(path, source) {
  const errors = [];
  const fail = (message) => errors.push(`${path}: ${message}`);
  if (path.startsWith("src/") && path.endsWith(".ts")) {
    const owner = path.split("/")[1];
    if (!domains.has(owner) && owner !== "core") return errors; // Explicit composition: index, capabilities, loader/contract.
    const tree = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (ts.isStringLiteralLike(node)) {
        const parent = node.parent;
        const imported =
          ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
            parent.moduleSpecifier === node) ||
          (ts.isLiteralTypeNode(parent) &&
            ts.isImportTypeNode(parent.parent)) ||
          (ts.isCallExpression(parent) &&
            (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
              parent.expression.getText(tree) === "require"));
        if (imported) {
          const specifier = node.text;
          if (
            owner === "core" &&
            (/^(?:@napi-rs\/|napi(?:$|[-/])|bindings$|node-gyp-build$)/.test(
              specifier,
            ) ||
              specifier.endsWith(".node"))
          )
            fail("TypeScript core must remain N-API independent");
          if (specifier.startsWith(".")) {
            const target = relative(
              "/native",
              resolve("/native", dirname(path), specifier),
            ).replaceAll("\\", "/");
            if (
              !target.startsWith(`src/${owner}/`) &&
              !(domains.has(owner) && target.startsWith("src/core/")) &&
              !(domains.has(owner) && target === "src/binding/loader.js")
            )
              fail(
                `domain import ${specifier} escapes ${owner} (domains may share core and binding/loader only)`,
              );
          } else if (
            specifier === "@nervekit/native" ||
            specifier.startsWith("@nervekit/")
          ) {
            fail(`domain import ${specifier} reaches outside native`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  if (path.startsWith("native/src/") && path.endsWith(".rs")) {
    const owner = path.split("/")[2];
    if (!domains.has(owner) && owner !== "core") return errors; // lib/api compose adapters.
    // Ignore comments and strings; dependencies are Rust path tokens, not textual mentions.
    const code = rustCode(source);
    for (const match of code.matchAll(
      /\bcrate\s*::\s*([a-zA-Z_][a-zA-Z_0-9]*|\{)/g,
    )) {
      const target = match[1];
      if (target === owner || target === "core") continue;
      fail(`Rust ${owner} cannot reference crate::${target}`);
    }
    const depth =
      path.slice("native/src/".length).split("/").length -
      (path.endsWith("/mod.rs") ? 1 : 0);
    const blocks = [];
    let inlineDepth = 0;
    for (const token of code.matchAll(
      /\bmod\s+[a-zA-Z_][a-zA-Z_0-9]*\s*\{|[{}]|\b((?:super\s*::\s*)+)([a-zA-Z_][a-zA-Z_0-9]*|\*|\{)/g,
    )) {
      if (token[1]) {
        const count = [...token[1].matchAll(/super/g)].length;
        if (count >= depth + inlineDepth)
          fail("relative Rust path escapes domain");
      } else if (token[0].endsWith("{")) {
        const module = token[0].startsWith("mod");
        blocks.push(module);
        if (module) inlineDepth++;
      } else if (blocks.pop()) inlineDepth--;
    }
    if (/#\s*\[\s*path\s*=/.test(code))
      fail("Rust path attributes bypass domain layout");
    if (owner === "core" && /\bnapi(?:_derive)?\b/.test(code))
      fail("core must remain N-API independent");
    if (
      domains.has(owner) &&
      !path.endsWith("/napi.rs") &&
      /\bnapi(?:_derive)?\s*::|#\[napi/.test(code)
    )
      fail("N-API belongs only in the domain napi.rs adapter");
  }
  return errors;
}

export function checkTree(root) {
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(resolve(root, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if ([".ts", ".rs"].includes(extname(path)))
        errors.push(
          ...checkSource(path, readFileSync(resolve(root, path), "utf8")),
        );
    }
  }
  walk("src");
  walk("native/src");
  return errors;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = checkTree(fileURLToPath(new URL("../", import.meta.url)));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Native internal dependency boundaries passed.");
}
