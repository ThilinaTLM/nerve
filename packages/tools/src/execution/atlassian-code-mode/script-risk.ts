import type { ToolRisk } from "@nervekit/contracts/permissions";
import { type ToolName, toolNameSchema } from "@nervekit/contracts/tools";
import { classifyToolRisk } from "../../catalog/manifest.js";
import { findSdkMethod } from "./sdk.js";
import type { MethodRisk } from "./sdk-types.js";

/**
 * Risk of a code-mode script, from its text, before it runs. Approval is for
 * the script as a whole; the broker still checks every SDK call at runtime
 * against this ceiling, so a script that hides a call from the scanner is
 * refused when it makes it.
 */
export type CodeModeRisk = "read" | "workspace_write" | "destructive";

const RANK: Record<CodeModeRisk, number> = {
  read: 0,
  workspace_write: 1,
  destructive: 2,
};

export type CodeModeClassification = {
  risk: CodeModeRisk;
  /** Human-readable operations found, e.g. `confluence.pages.update ×2 (98506)`. */
  operations: string[];
};

export function codeModeRiskWithin(
  risk: CodeModeRisk,
  ceiling: CodeModeRisk,
): boolean {
  return RANK[risk] <= RANK[ceiling];
}

export function describeCodeModeRisk(risk: CodeModeRisk): string {
  return risk === "workspace_write" ? "write" : risk;
}

/** Maps the effective risk of one direct tool call onto the code-mode scale; anything beyond reads and writes is destructive. */
export function codeModeRiskOfToolRisk(risk: ToolRisk): CodeModeRisk {
  switch (risk) {
    case "read":
    case "network":
    case "interaction":
      return "read";
    case "workspace_write":
    case "command":
      return "workspace_write";
    default:
      return "destructive";
  }
}

/** Risk of one nested call: the direct tool's argument-aware risk, so `comments.add` is a write while a delete is destructive. */
export function codeModeToolRisk(
  toolName: ToolName,
  args: Record<string, unknown> = {},
): CodeModeRisk {
  return codeModeRiskOfToolRisk(classifyToolRisk(toolName, args));
}

/** Risk a method's declaration stands for on the code-mode scale. */
export function codeModeRiskOfMethod(risk: MethodRisk): CodeModeRisk {
  switch (risk) {
    case "none":
    case "read":
      return "read";
    case "write":
      return "workspace_write";
    case "destructive":
      return "destructive";
  }
}

/**
 * Guards the declaration against the authorization: a method must not be
 * declared as less risky than the direct tool call it is checked as, or the
 * script scan would under-report what the call does.
 */
export function assertDeclaredRisk(
  name: string,
  declared: MethodRisk,
  authorizations: readonly {
    toolName: string;
    args: Record<string, unknown>;
  }[],
): void {
  const ceiling =
    declared === "none" ? -1 : RANK[codeModeRiskOfMethod(declared)];
  for (const { toolName, args } of authorizations) {
    const parsed = toolNameSchema.safeParse(toolName);
    const effective = parsed.success
      ? codeModeToolRisk(parsed.data, args)
      : "destructive";
    if (RANK[effective] > ceiling) {
      throw new Error(
        `Internal error: ${name} declares risk "${declared}" but is authorized as ${toolName} with ${describeCodeModeRisk(effective)} risk; fix the method's risk declaration.`,
      );
    }
  }
}

/** Methods whose risk depends on a literal argument. */
const ARGUMENT_DEPENDENT = new Set([
  "jira.request",
  "confluence.request",
  "files.write",
]);

const SDK_GLOBALS = new Set([
  "jira",
  "confluence",
  "diagram",
  "files",
  "image",
]);
/** Ways to reach an SDK global or run code without naming it. */
const ESCAPES = new Set([
  "eval",
  "Function",
  "globalThis",
  "self",
  "constructor",
]);
const TARGET_KEYS = new Set(["id", "key", "space", "project"]);
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
        text += source[i + 1] ?? "";
        i += 2;
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
        if (source[i] === "\\") i += 1;
        text += source[i] ?? "";
        i += 1;
      }
      i += 1;
      push("str", text);
    } else if (char === "`") {
      i += 1;
      templateText(false);
    } else if (/[A-Za-z_$]/.test(char)) {
      const start = i;
      while (i < source.length && /[\w$]/.test(source[i])) i += 1;
      push("id", source.slice(start, i));
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

/** `files.write` writes outside the artifact folder only with `workspace: true`. */
function writesWorkspace(args: Token[][]): boolean {
  const options = args[2];
  if (!options) return false;
  if (options[0]?.text !== "{" || options.some((t) => t.text === "..."))
    return true;
  const at = options.findIndex(
    (token) => token.kind === "id" && token.text === "workspace",
  );
  if (at === -1) return false;
  return !(options[at + 1]?.text === ":" && options[at + 2]?.text === "false");
}

type Found = { risk: CodeModeRisk; targets: string[] };

/**
 * Finds the SDK calls in a script. Anything that is not a plain
 * `global.path(...)` call on a known method — bracket access, aliasing,
 * `globalThis`, `eval` — counts as destructive, because the scanner cannot
 * tell what it reaches.
 */
export function classifyCodeModeScript(code: string): CodeModeClassification {
  const [division, regex] = [
    tokenize(code, "division"),
    tokenize(code, "regex"),
  ];
  const first = classifyTokens(division);
  if (JSON.stringify(division) === JSON.stringify(regex)) return first;
  // The readings disagree: report the riskier, and every operation either found.
  const second = classifyTokens(regex);
  return {
    risk: RANK[second.risk] > RANK[first.risk] ? second.risk : first.risk,
    operations: [...new Set([...first.operations, ...second.operations])],
  };
}

function classifyTokens(tokens: Token[]): CodeModeClassification {
  const found = new Map<string, Found[]>();
  const record = (name: string, risk: CodeModeRisk, targets: string[] = []) =>
    found.set(name, [...(found.get(name) ?? []), { risk, targets }]);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== "id") continue;
    if (tokens[i - 1]?.text === "." && tokens[i - 1]?.kind === "punct")
      continue;
    if (ESCAPES.has(token.text)) {
      record(`${token.text} (not analysable)`, "destructive");
      continue;
    }
    if (!SDK_GLOBALS.has(token.text)) continue;
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
    const method = findSdkMethod(name);
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
      } else {
        const verb = literal(args[0])?.toUpperCase();
        const path = literal(args[1]);
        if (verb === "GET") record(`${name} GET`, "read", path ? [path] : []);
        else if (verb)
          record(`${name} ${verb}`, "destructive", path ? [path] : []);
        else record(`${name} (computed method)`, "destructive");
      }
      continue;
    }
    record(name, codeModeRiskOfMethod(method.risk), targets);
  }

  let risk: CodeModeRisk = "read";
  const operations: string[] = [];
  for (const [name, calls] of found) {
    for (const call of calls)
      if (RANK[call.risk] > RANK[risk]) risk = call.risk;
    const targets = [...new Set(calls.flatMap((call) => call.targets))];
    operations.push(
      `${name}${calls.length > 1 ? ` ×${calls.length}` : ""}${targets.length > 0 ? ` (${targets.join(", ")})` : ""}`,
    );
  }
  return { risk, operations };
}

/** Classifies the arguments of an `atlassian_code_mode` call. */
export function classifyCodeModeArguments(
  args: Record<string, unknown>,
): CodeModeClassification {
  return typeof args.code === "string"
    ? classifyCodeModeScript(args.code)
    : { risk: "destructive", operations: [] };
}
