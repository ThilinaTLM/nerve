import type { ToolRisk } from "@nervekit/contracts/permissions";
import {
  type QuickScriptOperation,
  type ToolName,
  toolNameSchema,
} from "@nervekit/contracts/tools";
import { classifyToolRisk } from "../../catalog/index.js";
import type { QuickScriptRegistry } from "../registry.js";
import { sdkGlobals } from "./sdk-globals.js";
import { createSdkEnvironment, findSdkMethod } from "./sdk.js";
import {
  isOperationCheck,
  type NestedAuthorization,
  type MethodRisk,
  type NestedCheck,
} from "./sdk-types.js";

/**
 * Risk of a quick-script script, from its text, before it runs. Approval is for
 * the script as a whole; the broker still checks every SDK call at runtime
 * against this ceiling, so a script that hides a call from the scanner is
 * refused when it makes it.
 */
export type QuickScriptRisk =
  | "read"
  | "network"
  | "workspace_write"
  | "external_write"
  | "destructive";

/** Workspace and external writes share a rank: either ceiling admits the other. */
const RANK: Record<QuickScriptRisk, number> = {
  read: 0,
  network: 1,
  workspace_write: 2,
  external_write: 2,
  destructive: 3,
};

/** One SDK call the scan found that policy checks as an operation. */
export type ScannedCall = {
  /** `<namespace>.<path>`, e.g. `jira.comments.add`. */
  operation: string;
  /** The call's own risk: the method's, or for raw requests GET `network` and anything else `destructive`. */
  risk: MethodRisk;
  /** Normalized resources (`jira:issue/SCRUM-1`); undefined when the arguments are not literal, so they are known only when the call runs. */
  targets: string[] | undefined;
};

export type QuickScriptClassification = {
  risk: QuickScriptRisk;
  /** Human-readable operations found, e.g. `confluence.pages.update ×2 (98506)`. */
  operations: string[];
  /** The operation calls found, with normalized targets, for operation rules. */
  calls: ScannedCall[];
  /**
   * Every call with an effect is one of `calls`: nothing unanalysable (aliasing,
   * `eval`, a computed request method) and nothing checked as a direct tool
   * (`web.*`, workspace `files.*`, `image`). Only then may operation rules admit
   * the script.
   */
  admissible: boolean;
};

/** The operations of a scan for display: one entry per operation, targets merged. */
export function summarizeScannedCalls(
  calls: readonly ScannedCall[],
): QuickScriptOperation[] {
  const byOperation = new Map<string, QuickScriptOperation>();
  for (const call of calls) {
    const entry = byOperation.get(call.operation) ?? {
      operation: call.operation,
      targets: [],
      targetsKnown: true,
      count: 0,
    };
    entry.count += 1;
    if (call.targets === undefined) entry.targetsKnown = false;
    else
      for (const target of call.targets)
        if (!entry.targets.includes(target)) entry.targets.push(target);
    byOperation.set(call.operation, entry);
  }
  return [...byOperation.values()];
}

export function quickScriptRiskWithin(
  risk: QuickScriptRisk,
  ceiling: QuickScriptRisk,
): boolean {
  return RANK[risk] <= RANK[ceiling];
}

/** The riskier of two; on a rank tie `external_write` wins, so the result does not depend on order. */
function higherRisk(a: QuickScriptRisk, b: QuickScriptRisk): QuickScriptRisk {
  if (RANK[a] !== RANK[b]) return RANK[a] > RANK[b] ? a : b;
  return a === "external_write" || b === "external_write"
    ? "external_write"
    : a;
}

export function describeQuickScriptRisk(risk: QuickScriptRisk): string {
  return risk.replaceAll("_", " ");
}

/** Maps the effective risk of one direct tool call onto the quick-script scale; anything beyond reads and writes is destructive. */
export function quickScriptRiskOfToolRisk(risk: ToolRisk): QuickScriptRisk {
  switch (risk) {
    case "read":
    case "interaction":
      return "read";
    case "network":
      return "network";
    case "workspace_write":
      return "workspace_write";
    case "command":
      return "external_write";
    default:
      return "destructive";
  }
}

/** Risk of one nested call: the direct tool's argument-aware risk, so `comments.add` is a write while a delete is destructive. */
export function quickScriptToolRisk(
  toolName: ToolName,
  args: Record<string, unknown> = {},
): QuickScriptRisk {
  return quickScriptRiskOfToolRisk(classifyToolRisk(toolName, args));
}

/** Risk a method's declaration stands for on the quick-script scale. */
export function quickScriptRiskOfMethod(risk: MethodRisk): QuickScriptRisk {
  switch (risk) {
    case "none":
    case "read":
      return "read";
    case "network":
      return "network";
    case "write":
      return "workspace_write";
    case "external_write":
      return "external_write";
    case "destructive":
      return "destructive";
  }
}

/**
 * Guards the declaration against the authorization: a method must not be
 * declared as less risky than the check it runs (an operation's own risk, or
 * the direct tool call it is authorized as), or the script scan would
 * under-report what the call does.
 */
export function assertDeclaredRisk(
  name: string,
  declared: MethodRisk,
  authorizations: readonly NestedCheck[],
): void {
  const ceiling =
    declared === "none" ? -1 : RANK[quickScriptRiskOfMethod(declared)];
  for (const check of authorizations) {
    let effective: QuickScriptRisk;
    let label: string;
    if (isOperationCheck(check)) {
      effective = quickScriptRiskOfMethod(check.risk);
      label = check.operation;
    } else {
      const parsed = toolNameSchema.safeParse(check.toolName);
      effective = parsed.success
        ? quickScriptToolRisk(parsed.data, check.args)
        : "destructive";
      label = check.toolName;
    }
    if (RANK[effective] > ceiling) {
      throw new Error(
        `Internal error: ${name} declares risk "${declared}" but is authorized as ${label} with ${describeQuickScriptRisk(effective)} risk; fix the method's risk declaration.`,
      );
    }
  }
}

/** Methods whose risk depends on a literal argument. */
const ARGUMENT_DEPENDENT = new Set(["files.write", "files.edit"]);

/** Ways to reach an SDK global or run code without naming it. */
const ESCAPES = new Set([
  "eval",
  "Function",
  "globalThis",
  "self",
  "constructor",
  "__proto__",
]);
/** Escapes that are harmless as properties (`url.host`); the sandbox's `host.call(...)` is only an escape when called. */
const GLOBAL_ONLY_ESCAPES = new Set(["host"]);
const TARGET_KEYS = new Set(["id", "key", "space", "project"]);
/** Identifier characters, including `\\uXXXX` / `\\u{X}` escapes, which name the same identifier as the plain letters. */
const IDENTIFIER =
  /(?:[\p{ID_Continue}$\u200c\u200d]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})+/uy;
const IDENTIFIER_START = /[\p{ID_Start}$_]/u;
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/** Decodes the escape at `source[at]` (a backslash): its text and the index after it. */
function readEscape(source: string, at: number): [string, number] {
  const next = source[at + 1] ?? "";
  const code = (digits: string, end: number): [string, number] | undefined =>
    /^[0-9a-fA-F]+$/.test(digits)
      ? [String.fromCodePoint(Math.min(parseInt(digits, 16), 0x10ffff)), end]
      : undefined;
  if (next === "u" && source[at + 2] === "{") {
    const close = source.indexOf("}", at + 3);
    const decoded =
      close === -1 ? undefined : code(source.slice(at + 3, close), close + 1);
    if (decoded) return decoded;
  } else if (next === "u") {
    const decoded = code(source.slice(at + 2, at + 6), at + 6);
    if (decoded) return decoded;
  } else if (next === "x") {
    const decoded = code(source.slice(at + 2, at + 4), at + 4);
    if (decoded) return decoded;
  }
  if (next === "\r" && source[at + 2] === "\n") return ["", at + 3];
  if (next === "\n" || next === "\r") return ["", at + 2];
  return [SIMPLE_ESCAPES[next] ?? next, at + 2];
}

const decodeEscapes = (text: string): string =>
  text.includes("\\")
    ? text.replace(
        /\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4})/g,
        (escape) => readEscape(escape, 0)[0],
      )
    : text;

/** Keywords after which `/` starts a regular expression. */
const REGEX_AFTER = new Set(["return", "typeof", "case", "in", "of", "yield"]);

type Token = {
  kind: "id" | "str" | "tmpl" | "num" | "regex" | "punct";
  text: string;
};

/**
 * Splits TypeScript into tokens, dropping comments and keeping string
 * contents only as `str` tokens, so text inside strings and comments never
 * looks like code. Template substitutions are tokenized as code.
 *
 * A `/` after `)` or `}` is ambiguous without parsing (`(a) / b` divides,
 * `if (a) /re/.test(b)` starts a regular expression), and misreading it can
 * hide code inside a bogus string or regex. `slashAfterCloser` says how to
 * read it; the classifier scans both.
 */
function tokenize(
  source: string,
  slashAfterCloser: "division" | "regex",
): Token[] {
  const tokens: Token[] = [];
  const braces: Array<"{" | "${"> = [];
  let i = 0;

  const push = (kind: Token["kind"], text: string) =>
    tokens.push({ kind, text });
  /** Reads template text from `i` up to the closing backtick or the next `${`. */
  const templateText = (open: boolean) => {
    let text = "";
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        const [decoded, end] = readEscape(source, i);
        text += decoded;
        i = end;
      } else if (char === "`") {
        i += 1;
        push(open ? "tmpl" : "str", text);
        return;
      } else if (char === "$" && source[i + 1] === "{") {
        i += 2;
        push("tmpl", text);
        push("punct", "${");
        braces.push("${");
        return;
      } else {
        text += char;
        i += 1;
      }
    }
    push("tmpl", text);
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (/\s/.test(char)) i += 1;
    else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      let text = "";
      i += 1;
      while (i < source.length && source[i] !== char && source[i] !== "\n") {
        if (source[i] === "\\") {
          const [decoded, end] = readEscape(source, i);
          text += decoded;
          i = end;
        } else {
          text += source[i];
          i += 1;
        }
      }
      i += 1;
      push("str", text);
    } else if (char === "`") {
      i += 1;
      templateText(false);
    } else if (
      IDENTIFIER_START.test(String.fromCodePoint(source.codePointAt(i)!)) ||
      (char === "\\" && next === "u")
    ) {
      IDENTIFIER.lastIndex = i;
      const match = IDENTIFIER.exec(source);
      if (match) {
        i += match[0].length;
        push("id", decodeEscapes(match[0]));
      } else {
        i += 1;
        push("punct", char);
      }
    } else if (/\d/.test(char)) {
      const start = i;
      while (i < source.length && /[\w.]/.test(source[i])) i += 1;
      push("num", source.slice(start, i));
    } else if (
      char === "/" &&
      startsRegex(tokens[tokens.length - 1], slashAfterCloser)
    ) {
      let inClass = false;
      i += 1;
      while (i < source.length && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") i += 1;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "\n") break;
        i += 1;
      }
      i += 1;
      while (i < source.length && /\w/.test(source[i])) i += 1;
      push("regex", "");
    } else if (
      char === "?" &&
      next === "." &&
      !/\d/.test(source[i + 2] ?? "")
    ) {
      i += 2;
      push("punct", ".");
    } else if (char === "." && next === "." && source[i + 2] === ".") {
      i += 3;
      push("punct", "...");
    } else if (char === "{") {
      i += 1;
      braces.push("{");
      push("punct", "{");
    } else if (char === "}") {
      i += 1;
      push("punct", "}");
      if (braces.pop() === "${") templateText(true);
    } else {
      i += 1;
      push("punct", char);
    }
  }
  return tokens;
}

function startsRegex(
  previous: Token | undefined,
  slashAfterCloser: "division" | "regex",
): boolean {
  if (!previous) return true;
  if (previous.kind === "id") return REGEX_AFTER.has(previous.text);
  if (previous.kind !== "punct") return false;
  if (previous.text === "]") return false;
  if (previous.text === ")" || previous.text === "}")
    return slashAfterCloser === "regex";
  return true;
}

/** Top-level arguments of the call whose `(` is at `open`. */
function callArguments(tokens: Token[], open: number): Token[][] {
  const args: Token[][] = [];
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === "punct") {
      if (["(", "[", "{", "${"].includes(token.text)) {
        depth += 1;
        if (depth === 1) continue;
      } else if ([")", "]", "}"].includes(token.text)) {
        depth -= 1;
        if (depth === 0) return args;
      } else if (token.text === "," && depth === 1) {
        args.push([]);
        continue;
      }
    }
    if (depth >= 1) {
      if (args.length === 0) args.push([]);
      args[args.length - 1].push(token);
    }
  }
  return args;
}

const literal = (argument: Token[] | undefined): string | undefined =>
  argument?.length === 1 && argument[0].kind === "str"
    ? argument[0].text
    : undefined;

/** Literal identifiers of the call: a string first argument or `{ id: "…" }` values. */
function callTargets(args: Token[][]): string[] {
  const first = args[0];
  if (!first) return [];
  const direct = literal(first);
  if (direct !== undefined) return [direct];
  const targets: string[] = [];
  let depth = 0;
  for (let i = 0; i < first.length; i += 1) {
    const token = first[i];
    if (token.kind === "punct") {
      if (["(", "[", "{", "${"].includes(token.text)) depth += 1;
      else if ([")", "]", "}"].includes(token.text)) depth -= 1;
    } else if (
      depth === 1 &&
      token.kind === "id" &&
      TARGET_KEYS.has(token.text) &&
      first[i + 1]?.text === ":" &&
      (first[i + 2]?.kind === "str" || first[i + 2]?.kind === "num")
    )
      targets.push(first[i + 2].text);
  }
  return targets;
}

/** Top-level properties of an object literal: key text (undefined when computed, spread or otherwise not a plain key) and the value tokens. */
function objectProperties(
  options: Token[],
): Array<{ key?: string; value: Token[] }> | undefined {
  if (options[0]?.text !== "{" || options[options.length - 1]?.text !== "}")
    return undefined;
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of options.slice(1, -1)) {
    if (token.kind === "punct") {
      if (["(", "[", "{", "${"].includes(token.text)) depth += 1;
      else if ([")", "]", "}"].includes(token.text)) depth -= 1;
      else if (token.text === "," && depth === 0) {
        parts.push([]);
        continue;
      }
    }
    parts[parts.length - 1].push(token);
  }
  return parts
    .filter((part) => part.length > 0)
    .map((part) => {
      const [key, colon] = part;
      if ((key.kind === "id" || key.kind === "str") && colon?.text === ":")
        return { key: key.text, value: part.slice(2) };
      // Shorthand `{ workspace }`.
      if (key.kind === "id" && part.length === 1)
        return { key: key.text, value: part };
      return { value: part };
    });
}

/** Namespaces whose calls are checked as direct tools (`web_fetch`, `read` / `write` / `edit`), not as operations. */
const DIRECT_PRODUCTS = new Set(["web", "files", "image"]);

/** `files.write` writes outside the artifact folder only with `workspace: true`; anything that might set it counts. */
function writesWorkspace(args: Token[][]): boolean {
  const options = args[2];
  if (!options) return false;
  const properties = objectProperties(options);
  if (!properties) return true;
  // A computed key, spread or method could name `workspace`.
  if (properties.some((property) => property.key === undefined)) return true;
  const workspace = properties.filter(
    (property) => property.key === "workspace",
  );
  return workspace.some(
    (property) =>
      !(property.value.length === 1 && property.value[0].text === "false"),
  );
}

/** `files.edit` changes the workspace unless its handle is a literal `artifact:` one. */
function editsWorkspace(args: Token[][]): boolean {
  return !literal(args[0])?.startsWith("artifact:");
}

const NOT_LITERAL = Symbol("not literal");

/** The value of a literal expression (strings, numbers, booleans, null, arrays and plain objects of those), or NOT_LITERAL. */
function literalValue(tokens: Token[]): unknown {
  let at = 0;
  const parse = (): unknown => {
    const token = tokens[at];
    if (!token) return NOT_LITERAL;
    if (token.kind === "str") {
      at += 1;
      return token.text;
    }
    if (token.kind === "num" && /^\d+(\.\d+)?$/.test(token.text)) {
      at += 1;
      return Number(token.text);
    }
    if (token.kind === "id" && ["true", "false", "null"].includes(token.text)) {
      at += 1;
      return token.text === "null" ? null : token.text === "true";
    }
    if (token.text === "[" && token.kind === "punct") {
      at += 1;
      const items: unknown[] = [];
      while (tokens[at]?.text !== "]") {
        const item = parse();
        if (item === NOT_LITERAL) return NOT_LITERAL;
        items.push(item);
        if (tokens[at]?.text === ",") at += 1;
        else if (tokens[at]?.text !== "]") return NOT_LITERAL;
      }
      at += 1;
      return items;
    }
    if (token.text === "{" && token.kind === "punct") {
      at += 1;
      const object: Record<string, unknown> = {};
      while (tokens[at]?.text !== "}") {
        const key = tokens[at];
        if (
          !key ||
          (key.kind !== "id" && key.kind !== "str") ||
          tokens[at + 1]?.text !== ":" ||
          key.text === "__proto__"
        )
          return NOT_LITERAL;
        at += 2;
        const value = parse();
        if (value === NOT_LITERAL) return NOT_LITERAL;
        object[key.text] = value;
        if (tokens[at]?.text === ",") at += 1;
        else if (tokens[at]?.text !== "}") return NOT_LITERAL;
      }
      at += 1;
      return object;
    }
    return NOT_LITERAL;
  };
  const value = parse();
  return at === tokens.length ? value : NOT_LITERAL;
}

const scanEnvironments = new WeakMap<
  QuickScriptRegistry,
  ReturnType<typeof createSdkEnvironment>
>();

/**
 * The operation checks of a call with literal arguments, from the method's own
 * `authorize`, so targets are normalized exactly as at run time. Undefined when
 * an argument is not literal or the method rejects the arguments.
 */
function literalChecks(
  method: NonNullable<ReturnType<typeof findSdkMethod>>,
  args: Token[][],
  registry: QuickScriptRegistry,
): ScannedCall[] | undefined {
  const values = args.map(literalValue);
  if (values.includes(NOT_LITERAL)) return undefined;
  try {
    let scanEnvironment = scanEnvironments.get(registry);
    if (!scanEnvironment) {
      scanEnvironment = createSdkEnvironment({ cwd: process.cwd(), registry });
      scanEnvironments.set(registry, scanEnvironment);
    }
    const prepared = method.prepare(values, scanEnvironment);
    return [
      prepared.authorization,
      ...(prepared.additionalAuthorizations ?? []),
    ]
      .filter(
        (check): check is NestedAuthorization =>
          check !== undefined && isOperationCheck(check),
      )
      .map((check) => ({
        operation: check.operation,
        risk: check.risk,
        targets: check.targets.map((target) => target.value),
      }));
  } catch {
    return undefined;
  }
}

type Found = { risk: QuickScriptRisk; targets: string[] };

/**
 * Finds the SDK calls in a script. Anything that is not a plain
 * `global.path(...)` call on a known method — bracket access, aliasing,
 * `globalThis`, `eval` — counts as destructive, because the scanner cannot
 * tell what it reaches.
 */
export function classifyQuickScriptScript(
  code: string,
  registry: QuickScriptRegistry,
): QuickScriptClassification {
  const [division, regex] = [
    tokenize(code, "division"),
    tokenize(code, "regex"),
  ];
  const first = classifyTokens(division, registry);
  if (JSON.stringify(division) === JSON.stringify(regex)) return first;
  // The readings disagree: report the riskier, and every operation either found.
  const second = classifyTokens(regex, registry);
  const seen = new Set<string>();
  return {
    risk: higherRisk(first.risk, second.risk),
    operations: [...new Set([...first.operations, ...second.operations])],
    calls: [...first.calls, ...second.calls].filter((call) => {
      const key = JSON.stringify(call);
      return seen.has(key) ? false : (seen.add(key), true);
    }),
    admissible: first.admissible && second.admissible,
  };
}

function classifyTokens(
  tokens: Token[],
  registry: QuickScriptRegistry,
): QuickScriptClassification {
  const globals = sdkGlobals(registry);
  const found = new Map<string, Found[]>();
  const scanned: ScannedCall[] = [];
  let admissible = true;
  const record = (
    name: string,
    risk: QuickScriptRisk,
    targets: string[] = [],
    /** `operation`: policy checks it as an operation (listed in `calls`); `none`: no check; otherwise the scan cannot hand it to operation rules. */
    check: "operation" | "none" | "other" = "other",
  ) => {
    found.set(name, [...(found.get(name) ?? []), { risk, targets }]);
    if (check === "other") admissible = false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (
      token.kind === "str" &&
      tokens[i - 1]?.text === "[" &&
      tokens[i + 1]?.text === "]" &&
      ESCAPES.has(token.text)
    ) {
      record(`["${token.text}"] (not analysable)`, "destructive");
      continue;
    }
    if (token.kind !== "id") continue;
    // Escapes count wherever they appear, including as properties (`[].constructor.constructor`).
    const isProperty =
      tokens[i - 1]?.text === "." && tokens[i - 1]?.kind === "punct";
    if (
      ESCAPES.has(token.text) ||
      (!isProperty &&
        GLOBAL_ONLY_ESCAPES.has(token.text) &&
        (tokens[i + 1]?.text === "[" ||
          (tokens[i + 1]?.text === "." && tokens[i + 2]?.text === "call")))
    ) {
      record(`${token.text} (not analysable)`, "destructive");
      continue;
    }
    if (tokens[i - 1]?.text === "." && tokens[i - 1]?.kind === "punct") {
      // `this.jira` reaches the global when `this` is the global object.
      if (globals.has(token.text) && tokens[i - 2]?.text === "this")
        record(`this.${token.text} (not analysable)`, "destructive");
      continue;
    }
    // Bracket access by name: `x["constructor"]`.
    if (!globals.has(token.text)) continue;
    // `{ files: 1 }` names a property, not the global.
    if (
      tokens[i + 1]?.text === ":" &&
      ["{", ","].includes(tokens[i - 1]?.text ?? "")
    )
      continue;

    const path: string[] = [];
    let j = i + 1;
    while (tokens[j]?.text === "." && tokens[j + 1]?.kind === "id") {
      path.push(tokens[j + 1].text);
      j += 2;
    }
    if (tokens[j]?.text === "." && tokens[j + 1]?.text === "(") j += 1;
    const name = [token.text, ...path].join(".");
    // `image(handle)` returns a chain whose every operation is a host `image.*` call (read-only).
    if (name === "image" && tokens[j]?.text === "(") {
      record("image", "read", callTargets(callArguments(tokens, j)));
      continue;
    }
    const method = findSdkMethod(name, registry);
    if (path.length === 0 || tokens[j]?.text !== "(" || !method) {
      record(`${name} (not a direct call)`, "destructive");
      continue;
    }
    const args = callArguments(tokens, j);
    const targets = callTargets(args);
    if (ARGUMENT_DEPENDENT.has(name)) {
      if (name === "files.write") {
        if (writesWorkspace(args))
          record(`${name} (workspace)`, "workspace_write", targets);
      } else if (name === "files.edit") {
        if (editsWorkspace(args))
          record(`${name} (workspace)`, "workspace_write", targets);
      }
      continue;
    }
    const methodRisk = quickScriptRiskOfMethod(method.risk);
    if (method.risk === "none") record(name, methodRisk, targets, "none");
    else if (DIRECT_PRODUCTS.has(method.product))
      record(name, methodRisk, targets);
    else {
      // Literal arguments: the method's own authorization decides the risk (a raw request is a network read for GET, destructive otherwise).
      const checks = literalChecks(method, args, registry);
      const decided = checks?.reduce<QuickScriptRisk | undefined>(
        (highest, check) =>
          highest === undefined
            ? quickScriptRiskOfMethod(check.risk)
            : higherRisk(highest, quickScriptRiskOfMethod(check.risk)),
        undefined,
      );
      record(name, decided ?? methodRisk, targets, "operation");
      scanned.push(
        ...(checks ?? [
          { operation: name, risk: method.risk, targets: undefined },
        ]),
      );
    }
  }

  let risk: QuickScriptRisk = "read";
  const operations: string[] = [];
  for (const [name, calls] of found) {
    for (const call of calls) risk = higherRisk(risk, call.risk);
    const targets = [...new Set(calls.flatMap((call) => call.targets))];
    operations.push(
      `${name}${calls.length > 1 ? ` ×${calls.length}` : ""}${targets.length > 0 ? ` (${targets.join(", ")})` : ""}`,
    );
  }
  return { risk, operations, calls: scanned, admissible };
}

/** Classifies the arguments of an `quick_script` call. */
export function classifyQuickScriptArguments(
  args: Record<string, unknown>,
  registry: QuickScriptRegistry,
): QuickScriptClassification {
  return typeof args.code === "string"
    ? classifyQuickScriptScript(args.code, registry)
    : { risk: "destructive", operations: [], calls: [], admissible: false };
}
