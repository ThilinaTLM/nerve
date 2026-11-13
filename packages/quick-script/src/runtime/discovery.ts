import { readQuickScriptDoc } from "../docs-source.js";
import { artifactDir, writeArtifact } from "./files/artifacts.js";
import { renderLimits } from "../limits.js";
import type {
  NamespaceAvailability,
  RegisteredNamespace,
  SdkNamespace,
} from "../manifest-types.js";
import {
  declarationLine,
  describeDeclarations,
  docLine,
  groupMethods,
  methodsAt,
  parseSignature,
  typePool,
} from "./sdk-dts.js";
import { closeMatches } from "./sdk-args.js";
import {
  definePositionalMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "./sdk-types.js";
import { join } from "node:path";

/**
 * The `sdk` runtime namespace: `list`, `describe`, `search` and `docs` answer
 * from the registry, with risk `none`. All `sdk.*` text of one run shares a
 * budget well below the inline result budget (see the result projection), so
 * the script's own prints still fit. Output over the budget becomes a summary
 * plus a file the agent can page through.
 */

/** Characters of discovery text one run may return before `describe` and `docs` summarise. */
export const DISCOVERY_BUDGET_CHARS = 12_000;
/** A summary may use this much even when the budget is spent, so it can still say what to do next. */
const SUMMARY_FLOOR_CHARS = 1_500;
/** A single method's declaration is always returned in full up to this size. */
const SINGLE_METHOD_CHARS = 3_000;
const SEARCH_PAGE_SIZE = 20;
const SEARCH_LINE_CHARS = 150;

const available = (state?: NamespaceAvailability): boolean =>
  state === undefined || (state.configured && state.available);

type Registry = () => readonly RegisteredNamespace[];

function stateOf(
  namespace: RegisteredNamespace,
  env: SdkEnvironment,
): NamespaceAvailability | undefined {
  return namespace.source === "runtime"
    ? undefined
    : env.context.namespaces?.[namespace.id];
}

function unavailableText(
  namespace: RegisteredNamespace,
  state: NamespaceAvailability,
): string {
  if (state.available && state.configured) return "";
  if (state.available)
    return `${namespace.id} is not configured. Ask the user to enable it in Settings.`;
  return `${namespace.id} is unavailable: ${state.reason}\nFix: ${state.fix}`;
}

/** Spends the run's discovery budget on `text`. */
function spend(env: SdkEnvironment, text: string): string {
  env.discovery.used += text.length;
  return text;
}

const remaining = (env: SdkEnvironment) =>
  Math.max(0, DISCOVERY_BUDGET_CHARS - env.discovery.used);

function lookup(
  namespaces: readonly RegisteredNamespace[],
  id: string,
): RegisteredNamespace {
  const found = namespaces.find((namespace) => namespace.id === id);
  if (found) return found;
  const close = closeMatches(
    id,
    namespaces.map((namespace) => namespace.id),
  );
  throw new Error(
    `Unknown namespace '${id}'. ${close.length > 0 ? `Did you mean: ${close.join(", ")}? ` : ""}Namespaces: ${namespaces.map((namespace) => namespace.id).join(", ")}.`,
  );
}

function listText(
  namespaces: readonly RegisteredNamespace[],
  env: SdkEnvironment,
): string {
  const lines = [
    'Namespaces (sdk.describe("<id>") for declarations, sdk.docs("<id>") for topics):',
  ];
  for (const namespace of namespaces) {
    const state = stateOf(namespace, env);
    const usable = available(state);
    const facts = [
      namespace.source,
      ...(usable ? [] : ["unavailable"]),
      ...(namespace.methods.length > 0
        ? [
            `${namespace.methods.length} method${namespace.methods.length === 1 ? "" : "s"}`,
          ]
        : []),
      ...(namespace.docs.length > 0
        ? [`docs: ${namespace.docs.map((topic) => topic.id).join(", ")}`]
        : []),
    ];
    lines.push(`- ${namespace.id} (${facts.join("; ")}): ${namespace.summary}`);
    if (state && !usable) {
      if (state.available) lines.push("    reason: not enabled");
      else lines.push(`    reason: ${state.reason}`, `    fix: ${state.fix}`);
    }
  }
  return lines.join("\n");
}

function methodsSummary(
  namespace: SdkNamespace,
  methods: readonly SdkMethod[],
  limit: number,
): string[] {
  const lines: string[] = [];
  let size = 0;
  for (const [group, entries] of groupMethods(methods)) {
    const heading = `${group || "(ungrouped)"}: ${entries.length} methods`;
    lines.push(heading);
    size += heading.length + 1;
    for (const method of entries) {
      const doc = docLine(method);
      const line =
        `  ${namespace.id}.${method.path}${doc ? ` — ${doc}` : ""}`.slice(
          0,
          SEARCH_LINE_CHARS,
        );
      if (size + line.length + 1 > limit) {
        lines.push("  …");
        return lines;
      }
      lines.push(line);
      size += line.length + 1;
    }
  }
  return lines;
}

async function describeText(
  namespaces: readonly RegisteredNamespace[],
  path: string,
  env: SdkEnvironment,
): Promise<string> {
  const [id, ...rest] = path.split(".");
  const namespace = lookup(namespaces, id);
  const state = stateOf(namespace, env);
  if (!available(state)) return unavailableText(namespace, state!);
  const sub = rest.join(".") || undefined;
  const methods = methodsAt(namespace, sub);
  if (sub && methods.length === 0) {
    const groups = [...groupMethods(namespace.methods).keys()].filter(Boolean);
    const names = namespace.methods.map((method) => method.path);
    const close = closeMatches(sub, [...groups, ...names]);
    throw new Error(
      `${namespace.id} has no method or group '${sub}'. ${close.length > 0 ? `Did you mean: ${close.map((name) => `${namespace.id}.${name}`).join(", ")}? ` : ""}Groups: ${groups.join(", ") || "(none)"}.`,
    );
  }
  const docs = namespace.docs.map((topic) => topic.id);
  const pointer =
    docs.length > 0 && !sub
      ? `// Docs: ${docs.map((topic) => `sdk.docs("${topic}")`).join(", ")}\n`
      : "";
  if (namespace.methods.length === 0 && !namespace.callable) {
    return spend(
      env,
      `// ${namespace.id}: ${namespace.summary}. No method declarations.\n${pointer}`,
    );
  }
  const text =
    pointer + describeDeclarations(namespace, typePool(namespaces), sub);
  const single = methods.length === 1 && text.length <= SINGLE_METHOD_CHARS;
  if (single || text.length <= remaining(env)) return spend(env, text);

  // Over budget: a summary now, the full declarations in a file.
  const name = `sdk-${path.replaceAll(".", "-")}.d.ts`;
  let file = "";
  try {
    await writeArtifact(env, name, Buffer.from(text, "utf8"));
    file = join(artifactDir(env), name);
  } catch {
    // No conversation folder: the summary alone has to do.
  }
  const budget = Math.max(remaining(env), SUMMARY_FLOOR_CHARS);
  const head = [
    `${path}: ${methods.length} methods, ${Math.ceil(text.length / 1000)} KB of declarations, more than the ${Math.floor(remaining(env) / 1000)} KB left of this run's discovery budget.`,
    file ? `Full declarations: ${file} (page with read offsets or grep).` : "",
    `Narrow it: sdk.describe("${namespace.id}.<group>"), sdk.search("<words>", { in: "${namespace.id}" }).`,
  ].filter(Boolean);
  const body = methodsSummary(namespace, methods, budget - 400);
  return spend(env, [...head, ...body].join("\n"));
}

/** Ranked, paged one-line matches. */
function searchText(
  namespaces: readonly RegisteredNamespace[],
  query: string,
  scope: string | undefined,
  offset: number,
  env: SdkEnvironment,
): string {
  const searched = scope
    ? [lookup(namespaces, scope)]
    : namespaces.filter(
        (namespace) =>
          !namespace.callable && available(stateOf(namespace, env)),
      );
  if (scope) {
    const state = stateOf(searched[0], env);
    if (!available(state)) return unavailableText(searched[0], state!);
  }
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
  if (terms.length === 0)
    throw new Error("sdk.search needs a query with at least one word.");
  const hits: { line: string; score: number; order: number }[] = [];
  let order = 0;
  for (const namespace of searched) {
    for (const method of namespace.methods) {
      const path = `${namespace.id}.${method.path}`.toLowerCase();
      const { doc, declaration } = parseSignature(method);
      const docText = (doc ?? "").toLowerCase();
      const params = declaration.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (path.includes(term)) score += 10;
        else if (docText.includes(term)) score += 3;
        else if (params.includes(term)) score += 1;
        else {
          score = -1;
          break;
        }
      }
      if (score < 0) continue;
      const signature = declarationLine(method);
      hits.push({
        line: `${signature.length > SEARCH_LINE_CHARS ? `${signature.slice(0, SEARCH_LINE_CHARS - 1)}…` : signature}  [${method.risk}]`,
        score,
        order: order++,
      });
    }
  }
  const where = scope ?? "available namespaces";
  if (hits.length === 0)
    return spend(
      env,
      `No methods match "${query}" in ${where}. Try other words, or sdk.list() / sdk.docs("<namespace>").`,
    );
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  const page = hits.slice(offset, offset + SEARCH_PAGE_SIZE);
  if (page.length === 0)
    return spend(
      env,
      `No more matches: "${query}" has ${hits.length} in ${where}; offset ${offset} is past the end.`,
    );
  const end = offset + page.length;
  const next =
    end < hits.length
      ? `next: sdk.search(${JSON.stringify(query)}, { ${scope ? `in: ${JSON.stringify(scope)}, ` : ""}offset: ${end} })`
      : "";
  return spend(
    env,
    [
      `${hits.length} matches for "${query}" in ${where} (showing ${offset + 1}-${end}); sdk.describe("<path>") for types:`,
      ...page.map((hit) => hit.line),
      next,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function topicIndex(namespace: RegisteredNamespace): string[] {
  return namespace.docs.map((topic) => `- ${topic.id}: ${topic.whenToRead}`);
}

async function docsText(
  namespaces: readonly RegisteredNamespace[],
  topic: string | undefined,
  env: SdkEnvironment,
): Promise<string> {
  const usable = namespaces.filter((namespace) =>
    available(stateOf(namespace, env)),
  );
  if (!topic) {
    const lines = usable.flatMap(topicIndex);
    return spend(
      env,
      ['Topics (sdk.docs("<topic>") returns one):', ...lines].join("\n"),
    );
  }
  if (!topic.includes("/")) {
    const namespace = lookup(namespaces, topic);
    const state = stateOf(namespace, env);
    if (!available(state)) return unavailableText(namespace, state!);
    if (namespace.docs.length === 0)
      return spend(
        env,
        `${namespace.id} has no doc topics; sdk.describe("${namespace.id}") shows its methods.`,
      );
    return spend(
      env,
      [
        `${namespace.id} topics (sdk.docs("<topic>") returns one):`,
        ...topicIndex(namespace),
      ].join("\n"),
    );
  }
  const owner = namespaces.find((namespace) =>
    namespace.docs.some((entry) => entry.id === topic),
  );
  const entry = owner?.docs.find((candidate) => candidate.id === topic);
  if (!owner || !entry) {
    const all = namespaces.flatMap((namespace) =>
      namespace.docs.map((candidate) => candidate.id),
    );
    const close = closeMatches(topic, all);
    throw new Error(
      `Unknown doc topic '${topic}'. ${close.length > 0 ? `Did you mean: ${close.join(", ")}? ` : ""}Topics: ${all.join(", ")}.`,
    );
  }
  const state = stateOf(owner, env);
  if (!available(state)) return unavailableText(owner, state!);
  const text = renderLimits(readQuickScriptDoc(owner.owner, entry.file));
  if (text.length <= remaining(env)) return spend(env, text);

  const name = `sdk-docs-${topic.replaceAll("/", "-")}.md`;
  let file = "";
  try {
    await writeArtifact(env, name, Buffer.from(text, "utf8"));
    file = join(artifactDir(env), name);
  } catch {
    // No conversation folder: the excerpt alone has to do.
  }
  const limit = Math.max(remaining(env), SUMMARY_FLOOR_CHARS) - 300;
  const cut = text.lastIndexOf("\n\n", limit);
  const excerpt = text.slice(0, cut > 0 ? cut : limit);
  return spend(
    env,
    `${excerpt}\n\n[${topic}: first ${excerpt.length} of ${text.length} characters; this run's discovery budget is spent.${file ? ` Full text: ${file} (page with read offsets or grep).` : ""}]`,
  );
}

const text = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
};

/** The `sdk` namespace; `registry` supplies every registered namespace at call time. */
export function createSdkNamespace(registry: Registry): SdkNamespace {
  const methods: SdkMethod[] = [
    definePositionalMethod({
      product: "sdk",
      path: "list",
      risk: "none",
      maxArgs: 0,
      signature:
        "/** Every namespace with source, availability (reason and fix when unavailable), method count and doc topics. */ list(): string",
      parse: () => undefined,
      resource: () => "sdk",
      run: (_parsed, env) =>
        Promise.resolve(spend(env, listText(registry(), env))),
    }),
    definePositionalMethod({
      product: "sdk",
      path: "describe",
      risk: "none",
      maxArgs: 1,
      signature:
        '/** TypeScript declarations of a namespace ("jira"), group ("jira.issues") or method ("jira.issues.create") with the shapes they use. Large output becomes a summary plus a file. */ describe(path: string): Promise<string>',
      parse: (args) => text(args[0], "path"),
      resource: () => "sdk",
      run: (path, env) => describeText(registry(), path, env),
    }),
    definePositionalMethod({
      product: "sdk",
      path: "search",
      risk: "none",
      maxArgs: 2,
      signature:
        "/** Methods whose path, doc line or parameters match all words, best first, 20 per page; `in` limits it to one namespace. */ search(query: string, options?: { in?: string; offset?: number }): string",
      parse: (args) => {
        const options = (args[1] ?? {}) as Record<string, unknown>;
        if (typeof options !== "object" || Array.isArray(options))
          throw new Error("sdk.search options must be { in?, offset? }.");
        const unknown = Object.keys(options).filter(
          (key) => key !== "in" && key !== "offset",
        );
        if (unknown.length > 0)
          throw new Error(
            `sdk.search has no option '${unknown[0]}'; valid options: in, offset.`,
          );
        const offset = options.offset;
        if (
          offset !== undefined &&
          (typeof offset !== "number" ||
            !Number.isInteger(offset) ||
            offset < 0)
        )
          throw new Error("offset must be a non-negative integer.");
        return {
          query: text(args[0], "query"),
          scope: options.in === undefined ? undefined : text(options.in, "in"),
          offset: offset ?? 0,
        };
      },
      resource: () => "sdk",
      run: ({ query, scope, offset }, env) =>
        Promise.resolve(searchText(registry(), query, scope, offset, env)),
    }),
    definePositionalMethod({
      product: "sdk",
      path: "docs",
      risk: "none",
      maxArgs: 1,
      signature:
        '/** Doc topics: no argument lists every topic with when to read it, a namespace ("jira") lists its topics, a topic ("jira/workflows") returns its Markdown. */ docs(topic?: string): Promise<string>',
      parse: (args) =>
        args[0] === undefined ? undefined : text(args[0], "topic"),
      resource: () => "sdk",
      run: (topic, env) => docsText(registry(), topic, env),
    }),
  ];
  return {
    id: "sdk",
    summary: "discovery: list, describe, search, docs",
    methods,
    types: "",
    docs: [],
  };
}
