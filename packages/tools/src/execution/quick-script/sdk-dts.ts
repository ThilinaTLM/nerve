import type { SdkMethod } from "./sdk-types.js";
import type { SdkNamespace } from "./extensions/manifest-types.js";

/**
 * Declarations for `sdk.describe`, generated from the method tables: each
 * method's `signature` is a TypeScript method declaration, optionally preceded
 * by a one-line JSDoc comment. Methods with declared risk `destructive` get a
 * leading `Destructive.` (`Destructive unless GET.` for `request`). Overloads
 * are joined with `; ` in one signature. Shapes come from each namespace's
 * `types` block; a declaration brings the shapes it names, from any namespace.
 */

const SIGNATURE = /^(?:\/\*\*\s*(.*?)\s*\*\/\s*)?([\s\S]*)$/;

/** A method's JSDoc line and declaration; throws when the declaration does not start with the method name. */
export function parseSignature(method: SdkMethod): {
  doc?: string;
  declaration: string;
} {
  const name = method.path.split(".").pop() as string;
  const match = SIGNATURE.exec(method.signature);
  const declaration = match?.[2] ?? "";
  if (!declaration.startsWith(`${name}(`)) {
    throw new Error(
      `${method.product}.${method.path}: signature must declare ${name}(...)`,
    );
  }
  return { doc: match?.[1], declaration };
}

/** `Destructive.` text for a method, empty when it is not. `request` is destructive only for non-GET. */
function destructiveTag(method: SdkMethod): string {
  if (method.risk !== "destructive") return "";
  return method.path.split(".").pop() === "request"
    ? "Destructive unless GET."
    : "Destructive.";
}

/** The one line of documentation shown for a method, with its destructive tag. */
export function docLine(method: SdkMethod): string {
  return [destructiveTag(method), parseSignature(method).doc]
    .filter(Boolean)
    .join(" ");
}

function member(method: SdkMethod, indent: string): string[] {
  const name = method.path.split(".").pop() as string;
  const { declaration } = parseSignature(method);
  const text = docLine(method);
  return [
    ...(text ? [`${indent}/** ${text} */`] : []),
    ...declaration
      .split(new RegExp(`;\\s*(?=${name}\\()`))
      .map((overload) => `${indent}${overload.replace(/;$/, "")};`),
  ];
}

/** A method's declaration with its full path, on one line: for errors and search results. */
export function declarationLine(method: SdkMethod): string {
  const name = method.path.split(".").pop() as string;
  const { declaration } = parseSignature(method);
  return `${method.product}.${method.path}${declaration.slice(name.length)}`;
}

/** `jira.issues.search` becomes `issues: { search(...) }`; ungrouped methods sit directly on the global. */
function objectBody(methods: SdkMethod[]): string[] {
  const groups = new Map<string, SdkMethod[]>();
  const direct: SdkMethod[] = [];
  for (const method of methods) {
    const group = method.path.split(".").slice(0, -1).join(".");
    if (!group) direct.push(method);
    else groups.set(group, [...(groups.get(group) ?? []), method]);
  }
  return [
    ...[...groups].flatMap(([group, entries]) => [
      `  ${group}: {`,
      ...entries.flatMap((entry) => member(entry, "    ")),
      "  };",
    ]),
    ...direct.flatMap((entry) => member(entry, "  ")),
  ];
}

/** Top-level declarations of a types block by name, each with the comment lines directly above it. */
export function splitTypes(types: string): Map<string, string> {
  const chunks: { name: string; lines: string[] }[] = [];
  const head = { name: "", lines: [] as string[] };
  for (const line of types.split("\n")) {
    const start = /^(?:interface|type)\s+(\w+)/.exec(line);
    if (start) {
      // Comment lines at the end of the previous chunk belong to this declaration.
      const lines: string[] = [];
      const previous = (chunks.at(-1) ?? head).lines;
      while (previous && /^(?:\/\*\*|\/\/| \*)/.test(previous.at(-1) ?? "x"))
        lines.unshift(previous.pop() as string);
      chunks.push({ name: start[1], lines: [...lines, line] });
    } else (chunks.at(-1) ?? head).lines.push(line);
  }
  return new Map(
    chunks.map(({ name, lines }) => [name, lines.join("\n").trim()]),
  );
}

/** Type names a block of text mentions that exist in `pool`, transitively. */
function closure(
  seeds: string,
  pool: ReadonlyMap<string, string>,
): Set<string> {
  const found = new Set<string>();
  const queue = [seeds];
  while (queue.length > 0) {
    const text = queue.pop() as string;
    for (const [word] of text.matchAll(/\b[A-Z]\w*\b/g)) {
      if (found.has(word) || !pool.has(word)) continue;
      found.add(word);
      queue.push(pool.get(word) as string);
    }
  }
  return found;
}

/** Every namespace's shapes by name. */
export function typePool(
  namespaces: readonly SdkNamespace[],
): Map<string, string> {
  const pool = new Map<string, string>();
  for (const namespace of namespaces)
    for (const [name, text] of splitTypes(namespace.types))
      pool.set(name, text);
  return pool;
}

/** The methods a `describe` path selects: the whole namespace, one group (`issues`) or one method (`issues.get`). */
export function methodsAt(
  namespace: SdkNamespace,
  path: string | undefined,
): SdkMethod[] {
  if (!path) return namespace.methods;
  return namespace.methods.filter(
    (method) => method.path === path || method.path.startsWith(`${path}.`),
  );
}

/**
 * Declarations for a namespace, one of its groups or one method: the shapes
 * the declarations name (all of the namespace's own shapes for the whole
 * namespace), then the `declare const` block.
 */
export function describeDeclarations(
  namespace: SdkNamespace,
  pool: ReadonlyMap<string, string>,
  path?: string,
): string {
  const methods = methodsAt(namespace, path);
  const chain = namespace.callable;
  const members = chain
    ? [
        `interface ${chain.chain} {`,
        chain.steps,
        ...methods.flatMap((method) => member(method, "  ")),
        "}",
        chain.declaration,
      ]
    : [`declare const ${namespace.id}: {`, ...objectBody(methods), "};"];
  const own = splitTypes(namespace.types);
  const needed = closure(members.join("\n"), pool);
  const shapes = path ? [...needed] : [...new Set([...own.keys(), ...needed])];
  const typesText = shapes
    .map((name) => pool.get(name) as string)
    .filter(Boolean)
    // Own shapes keep their declared order; borrowed ones follow.
    .join("\n\n");
  return [typesText, members.join("\n")].filter(Boolean).join("\n\n") + "\n";
}

/** The methods of a namespace grouped as `group -> methods`; ungrouped methods use the empty group. */
export function groupMethods(
  methods: readonly SdkMethod[],
): Map<string, SdkMethod[]> {
  const groups = new Map<string, SdkMethod[]>();
  for (const method of methods) {
    const group = method.path.split(".").slice(0, -1).join(".");
    groups.set(group, [...(groups.get(group) ?? []), method]);
  }
  return groups;
}
