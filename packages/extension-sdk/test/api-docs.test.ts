// The configure-nerve skill ships the public .d.ts files of `@nervekit/extension-api` and
// `@nervekit/extension-sdk` as the agent's API reference (the agent has no source). This test keeps
// that reference complete: every exported declaration and every member of an exported object
// type, interface, class or object-literal constant needs a doc comment.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const sdkSrc = join(here, "..", "src");
const apiSrc = join(here, "..", "..", "extension-api", "src");

/** Public entry points: the SDK's `.`, `./testing` and `./ui` (which re-export the API's `.` and `./testing`). */
const entries = [
  join(sdkSrc, "index.ts"),
  join(sdkSrc, "testing.ts"),
  join(sdkSrc, "ui.ts"),
];

const program = ts.createProgram(entries, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  baseUrl: join(here, ".."),
  // Read the API's sources, not a possibly stale dist.
  paths: {
    "@nervekit/extension-api": [join(apiSrc, "index.ts")],
    "@nervekit/extension-api/testing": [join(apiSrc, "testing.ts")],
  },
});
const checker = program.getTypeChecker();

const inRepoSources = (file: ts.SourceFile) =>
  (file.fileName.startsWith(sdkSrc) || file.fileName.startsWith(apiSrc)) &&
  !file.fileName.includes("node_modules");

function hasDoc(node: ts.Node): boolean {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [];
  return docs.some((doc) => ts.getTextOfJSDocComment(doc.comment)?.trim());
}

function label(node: ts.Node, name: string): string {
  const file = node.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(node.getStart());
  return `${file.fileName.slice(file.fileName.indexOf("packages/"))}:${line + 1} ${name}`;
}

function memberName(member: ts.Node): string {
  const name = (member as { name?: ts.Node }).name;
  return name ? name.getText() : ts.SyntaxKind[member.kind];
}

/**
 * Types whose nested params/results are described by the comment of each entry: `Methods` (the
 * bridge methods; `host` documents every call) is checked one level deep.
 */
const shallow = new Set(["Methods"]);

const missing = new Set<string>();
const visited = new Set<ts.Node>();

function requireDoc(node: ts.Node, name: string) {
  if (!hasDoc(node)) missing.add(label(node, name));
}

/** Members of an object type literal / interface / class, then whatever their types contain. */
function checkMembers(owner: string, members: ts.NodeArray<ts.Node>) {
  for (const member of members) {
    if (
      ts.isIndexSignatureDeclaration(member) ||
      ts.isCallSignatureDeclaration(member) ||
      ts.isSemicolonClassElement(member)
    )
      continue;
    if (
      ts.canHaveModifiers(member) &&
      ts
        .getModifiers(member)
        ?.some(
          (m) =>
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword,
        )
    )
      continue;
    requireDoc(member, `${owner}.${memberName(member)}`);
    if (!shallow.has(owner)) visit(member, `${owner}.${memberName(member)}`);
  }
}

/** Follows a type so nested literals and local (unexported) helper types are checked too. */
function visit(node: ts.Node, owner: string) {
  if (visited.has(node)) return;
  visited.add(node);
  if (ts.isTypeLiteralNode(node)) {
    // Inline parameter types are described by the function's own comment.
    if (!ts.isParameter(node.parent)) checkMembers(owner, node.members);
    return;
  }
  if (ts.isTypeReferenceNode(node)) {
    const symbol = checker.getSymbolAtLocation(node.typeName);
    for (const declaration of symbol?.declarations ?? [])
      if (
        inRepoSources(declaration.getSourceFile()) &&
        (ts.isTypeAliasDeclaration(declaration) ||
          ts.isInterfaceDeclaration(declaration))
      ) {
        requireDoc(declaration, declaration.name.text);
        checkDeclaration(declaration);
      }
  }
  ts.forEachChild(node, (child) => visit(child, owner));
}

function checkDeclaration(declaration: ts.Declaration) {
  const name = (declaration as { name?: ts.Node }).name?.getText() ?? "?";
  if (visited.has(declaration)) return;
  visited.add(declaration);
  if (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isClassDeclaration(declaration)
  )
    checkMembers(name, declaration.members);
  else if (ts.isTypeAliasDeclaration(declaration))
    visit(declaration.type, name);
  else if (ts.isVariableDeclaration(declaration)) {
    if (declaration.type) visit(declaration.type, name);
    // With a type annotation the type documents the members.
    if (
      !declaration.type &&
      declaration.initializer &&
      ts.isObjectLiteralExpression(declaration.initializer)
    )
      checkObjectLiteral(name, declaration.initializer);
  } else if (ts.isFunctionDeclaration(declaration)) {
    // Parameters are described by the function's comment; object-literal types in them are not walked.
    if (declaration.type) visit(declaration.type, name);
  }
}

function checkObjectLiteral(
  owner: string,
  literal: ts.ObjectLiteralExpression,
) {
  for (const property of literal.properties) {
    const name = `${owner}.${memberName(property)}`;
    requireDoc(property, name);
    if (
      ts.isPropertyAssignment(property) &&
      ts.isObjectLiteralExpression(property.initializer)
    )
      checkObjectLiteral(name, property.initializer);
  }
}

test("every public declaration and member of the extension API has a doc comment", () => {
  const seen = new Set<ts.Symbol>();
  let exported = 0;
  for (const entry of entries) {
    const file = program.getSourceFile(entry);
    assert.ok(file, `${entry} is part of the program`);
    const moduleSymbol = checker.getSymbolAtLocation(file);
    assert.ok(moduleSymbol, `${entry} is a module`);
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      if (seen.has(target)) continue;
      seen.add(target);
      const own = (target.declarations ?? []).filter((declaration) =>
        inRepoSources(declaration.getSourceFile()),
      );
      // Re-exports of other packages (the Vitest functions) are documented there.
      if (own.length === 0) continue;
      exported += 1;
      for (const declaration of own) {
        // A variable's comment sits on its statement.
        const holder = ts.isVariableDeclaration(declaration)
          ? declaration.parent.parent
          : declaration;
        if (!hasDoc(holder) && !ts.isModuleDeclaration(declaration))
          missing.add(label(declaration, target.getName()));
        checkDeclaration(declaration);
      }
    }
  }
  assert.ok(exported > 100, `found ${exported} exported declarations`);
  assert.deepEqual(
    [...missing].sort(),
    [],
    "add a doc comment (meaning, units, defaults, limits, errors) to each declaration or member",
  );
});
