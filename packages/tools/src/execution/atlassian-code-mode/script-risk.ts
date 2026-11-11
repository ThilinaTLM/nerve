import type { ToolName } from "@nervekit/contracts/tools";
import { permissionMetadataForTool } from "../../catalog/permission-metadata.js";
import { findSdkMethod } from "./sdk.js";

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

/** Risk of a direct tool, on the code-mode scale: reads, writes, everything else. */
export function codeModeToolRisk(toolName: ToolName): CodeModeRisk {
  const category = permissionMetadataForTool(toolName).baseRisk;
  if (category === "read" || category === "network") return "read";
  return category === "write" ? "workspace_write" : "destructive";
}

/**
 * The direct tool each method is authorized as; `null` for calls with no
 * external effect. `request` and `files.write` depend on their arguments and
 * are classified separately. A new method missing here is treated as
 * destructive, and a test fails until it is listed.
 */
export const CODE_MODE_METHOD_TOOLS: Readonly<Record<string, ToolName | null>> =
  {
    "jira.issues.search": "jira_search_issues",
    "jira.issues.get": "jira_get_issue",
    "jira.projects.get": "jira_get_project",
    "jira.users.search": "jira_search_users",
    "jira.fields.list": "jira_get_project",
    "confluence.spaces.search": "confluence_search_spaces",
    "confluence.pages.search": "confluence_search_pages",
    "confluence.pages.get": "confluence_get_page",
    "confluence.pages.create": "confluence_create_page",
    "confluence.pages.update": "confluence_update_page",
    "confluence.attachments.upload": "confluence_manage_attachment",
    "confluence.labels.add": "confluence_manage_label",
    "confluence.comments.add": "confluence_manage_comment",
    "diagram.render": "kroki_export",
    "files.list": null,
    "files.read": "read",
    "image.info": "read",
    "image.save": "read",
  };

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
 */
function tokenize(source: string): Token[] {
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
    } else if (char === "/" && startsRegex(tokens[tokens.length - 1])) {
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

function startsRegex(previous: Token | undefined): boolean {
  if (!previous) return true;
  if (previous.kind === "id") return REGEX_AFTER.has(previous.text);
  return previous.kind === "punct" && ![")", "]", "}"].includes(previous.text);
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
  const tokens = tokenize(code);
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
    if (path.length === 0 || tokens[j]?.text !== "(" || !findSdkMethod(name)) {
      record(`${name} (not a direct call)`, "destructive");
      continue;
    }
    const args = callArguments(tokens, j);
    const targets = callTargets(args);
    if (ARGUMENT_DEPENDENT.has(name)) {
      if (name === "files.write") {
        if (writesWorkspace(args))
          record(`${name} (workspace)`, codeModeToolRisk("write"), targets);
      } else {
        const method = literal(args[0])?.toUpperCase();
        const path = literal(args[1]);
        if (method === "GET") record(`${name} GET`, "read", path ? [path] : []);
        else if (method)
          record(`${name} ${method}`, "destructive", path ? [path] : []);
        else record(`${name} (computed method)`, "destructive");
      }
      continue;
    }
    const tool = CODE_MODE_METHOD_TOOLS[name];
    record(
      name,
      tool ? codeModeToolRisk(tool) : tool === null ? "read" : "destructive",
      targets,
    );
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
