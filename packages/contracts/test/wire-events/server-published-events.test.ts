import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  allPublicEventDefinitions,
  publicEventDefinition,
} from "../../src/events/catalog.js";

function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : path.endsWith(".ts") &&
          !path.endsWith(".test.ts") &&
          !path.endsWith(".d.ts")
        ? [path]
        : [];
  });
}

void test("server-published event names belong to the public catalog and permit the server", () => {
  const root = fileURLToPath(
    new URL("../../../workbench-server/src", import.meta.url),
  );
  const publishers = new Set([
    "publish",
    "publishBestEffort",
    "publishBestEffortAndWait",
    "notify",
    "notifyDirect",
  ]);
  const published = new Map<string, string[]>();
  for (const path of sources(root)) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const method = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : ts.isIdentifier(node.expression)
            ? node.expression.text
            : undefined;
        if (method && publishers.has(method)) {
          const first = node.arguments[0];
          const type =
            first && ts.isObjectLiteralExpression(first)
              ? first.properties.find(
                  (property): property is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(property) &&
                    property.name.getText(source) === "type",
                )?.initializer
              : first;
          // Public names are qualified. Configuration signals also expose a
          // publish method, but use internal channels such as "agent".
          if (type && ts.isStringLiteralLike(type) && type.text.includes(".")) {
            const files = published.get(type.text) ?? [];
            files.push(path);
            published.set(type.text, files);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(
    allPublicEventDefinitions().every((definition) =>
      definition.name.includes("."),
    ),
    "Update publisher scanning if public names stop being qualified",
  );
  assert.ok(published.has("project.configuration.health"));
  for (const [name, files] of published) {
    const definition = publicEventDefinition(name);
    assert.ok(
      definition,
      `${name} published in ${files.join(", ")} is missing from the public catalog`,
    );
    assert.ok(
      definition.allowedSourceRoles.includes("workbench_server"),
      `${name} does not permit workbench_server`,
    );
  }
});

void test("every declared server event is registered, including names published through callbacks", async () => {
  const domains = fileURLToPath(new URL("../../src/domains", import.meta.url));
  for (const path of sources(domains).filter((path) =>
    path.endsWith("/events.ts"),
  )) {
    const module = (await import(path)) as Record<string, unknown>;
    for (const value of Object.values(module)) {
      if (!Array.isArray(value)) continue;
      for (const definition of value as {
        name?: string;
        allowedSourceRoles?: readonly string[];
      }[]) {
        if (
          !definition.allowedSourceRoles?.includes("workbench_server") ||
          !definition.name
        )
          continue;
        assert.ok(
          publicEventDefinition(definition.name),
          `${definition.name} declared in ${path} is not registered`,
        );
      }
    }
  }
});
