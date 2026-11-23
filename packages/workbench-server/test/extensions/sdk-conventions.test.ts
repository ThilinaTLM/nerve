import assert from "node:assert/strict";
import test from "node:test";
import { registeredMethods } from "./registry.js";

/*
 * The SDK conventions of docs/architecture/code-mode.md ("Namespace design
 * rules"), checked against every registered method. Agents write calls from
 * these conventions without reading declarations first, so a method that
 * breaks one needs an entry below with its reason.
 */

/** Verbs with one meaning in every namespace. */
const VERBS = new Set([
  "get",
  "list",
  "search",
  "create",
  "update",
  "delete",
  "add",
  "remove",
  "upload",
  "download",
]);

/** Other method names, each with why it is not one of the verbs. */
const OTHER_NAMES: Record<string, string> = {
  "atlassian.defaults": "the configured sites, project and space",
  "configuration.reload": "re-reads files; changes nothing",
  "configuration.check": "validates files; changes nothing",
  "configuration.explain": "evaluates the policy; runs nothing",
  "configuration.describe": "the conversation's own context, not a resource",
  "confluence.comments.reply": "Confluence's word for a child comment",
  "confluence.comments.resolve": "Confluence's action on an inline comment",
  "confluence.pages.move": "Confluence's action",
  "confluence.pages.restore": "undoes pages.delete",
  "confluence.request": "raw request",
  "diagram.render": "one-job namespace",
  "extensions.reload": "re-reads files; changes nothing",
  "extensions.status": "state of the last load",
  "files.edit": "mirrors the edit tool",
  "files.read": "mirrors the read tool",
  "files.write": "mirrors the write tool",
  "image.info": "end of the image(handle) chain",
  "image.save": "end of the image(handle) chain",
  "imagegen.generate": "one-job namespace",
  "jira.adf.fromMarkdown": "pure conversion",
  "jira.adf.toMarkdown": "pure conversion",
  "jira.issues.link": "Jira's action",
  "jira.issues.move": "Jira's action (to a sprint or the backlog)",
  "jira.issues.rank": "Jira's action",
  "jira.issues.transition": "Jira's action",
  "jira.issues.unlink": "Jira's action",
  "jira.request": "raw request",
  "jira.sprints.close": "Jira's action",
  "jira.sprints.issues": "the issues of one sprint, like issues.search",
  "jira.sprints.start": "Jira's action",
  "jira.users.me": "the account's own user",
  "sdk.describe": "discovery",
  "sdk.docs": "discovery",
  "search.web": "namespace per extension: web search is not part of `web`",
  "launches.move": "places an entry in the catalog tree",
  "launches.start": "runs a definition, like the Launches panel's start",
  "launches.restart": "stops and starts a run, like the Launches panel",
  "launches.stop": "ends a run; deletes nothing",
  "launches.logs": "a run's output, like async_bash logs",
  "web.fetch": "mirrors the web_fetch tool",
};

/** Resource groups that are not plural nouns. */
const SINGULAR_GROUPS: Record<string, string> = {
  "jira.adf": "a format, not a collection",
};

/** Methods with positional arguments; the description names them (`files.*`, `request`, `sdk.search`). */
const POSITIONAL = new Set([
  "files.read",
  "files.write",
  "files.edit",
  "jira.request",
  "confluence.request",
  "sdk.search",
]);

/** Options that identify the resource or carry the query: alone, they can be passed as a bare value. */
const BARE_OPTIONS = new Set(["id", "key", "query", "jql", "cql", "url"]);

const nameOf = (method: { product: string; path: string }) =>
  `${method.product}.${method.path}`;

/** The declaration without its leading doc comment, first overload only. */
function declaration(signature: string): string {
  return signature.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "");
}

/** Splits `text` at `separator` outside brackets and string literals. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if ("({[<".includes(char)) depth += 1;
    else if (")}]>".includes(char)) depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parameters of the declared method: `[{ name, type }]`. */
function parameters(signature: string): { name: string; type: string }[] {
  const text = declaration(signature);
  const open = text.indexOf("(");
  let depth = 0;
  let close = open;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  return splitTopLevel(text.slice(open + 1, close), ",").map((parameter) => {
    const colon = parameter.indexOf(":");
    return {
      name: parameter.slice(0, colon).replace("?", "").trim(),
      type: parameter.slice(colon + 1).trim(),
    };
  });
}

/** Required options of a `{ a: T; b?: U }` type: `[name, type]`. */
function requiredOptions(objectType: string): [string, string][] {
  return splitTopLevel(objectType.slice(1, -1), ";").flatMap(
    (property): [string, string][] => {
      const colon = property.indexOf(":");
      const name = property.slice(0, colon).trim();
      return name.endsWith("?")
        ? []
        : [[name, property.slice(colon + 1).trim()]];
    },
  );
}

void test("paths are namespace.resource.verb with verbs from one vocabulary", () => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const method of registeredMethods) {
    const name = nameOf(method);
    seen.add(name);
    const segments = method.path.split(".");
    if (segments.length > 2) problems.push(`${name}: more than resource.verb`);
    if (segments.some((segment) => !/^[a-z][A-Za-z]*$/.test(segment)))
      problems.push(`${name}: segments are camelCase words`);
    const verb = segments[segments.length - 1];
    if (!VERBS.has(verb) && !(name in OTHER_NAMES))
      problems.push(
        `${name}: '${verb}' is not a standard verb (${[...VERBS].join(", ")}); rename it or add it to OTHER_NAMES with the reason`,
      );
    if (VERBS.has(verb) && name in OTHER_NAMES)
      problems.push(`${name}: standard verb listed in OTHER_NAMES`);
    const group = segments.length === 2 ? segments[0] : undefined;
    if (
      group &&
      !group.endsWith("s") &&
      !(`${method.product}.${group}` in SINGULAR_GROUPS)
    )
      problems.push(`${name}: resource '${group}' is not plural`);
  }
  for (const name of Object.keys(OTHER_NAMES))
    if (!seen.has(name)) problems.push(`${name}: listed but not registered`);
  assert.deepEqual(problems, []);
});

void test("methods take one argument, and a lone ID, key or query can be passed bare", () => {
  const problems: string[] = [];
  for (const method of registeredMethods) {
    const name = nameOf(method);
    const declared = parameters(method.signature);
    if (POSITIONAL.has(name)) continue;
    if (declared.length > 1) {
      problems.push(`${name}: takes ${declared.length} arguments`);
      continue;
    }
    const [first] = declared;
    // A single object type; unions already offer the bare form or are alternatives.
    if (!first || !/^\{[\s\S]*\}$/.test(first.type)) continue;
    if (splitTopLevel(first.type, "|").length > 1) continue;
    if (method.path.split(".").pop() === "update") continue;
    const required = requiredOptions(first.type);
    if (
      required.length === 1 &&
      BARE_OPTIONS.has(required[0][0]) &&
      /^(string|number)$/.test(required[0][1])
    )
      problems.push(
        `${name}: '${required[0][0]}' is the only required option, so the method must also take it bare (${required[0][1]} | { ... })`,
      );
  }
  assert.deepEqual(problems, []);
});

void test("methods with a limit return an array and state its default and maximum", () => {
  const problems: string[] = [];
  for (const method of registeredMethods) {
    const [first] = parameters(method.signature);
    if (!first || !/\blimit\?: number\b/.test(first.type)) continue;
    const name = nameOf(method);
    if (!/\[\]>$/.test(declaration(method.signature)))
      problems.push(`${name}: has a limit but does not return an array`);
    if (!/limit default \d+, max \d+/.test(method.signature))
      problems.push(
        `${name}: the doc comment must say 'limit default N, max M'`,
      );
  }
  assert.deepEqual(problems, []);
});
