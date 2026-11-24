import {
  quickScriptRiskOfMethod,
  higherRisk,
  type QuickScriptRisk,
} from "./script-risk.js";
import type { QuickScriptOperation } from "@nervekit/contracts/tools";
import type { QuickScriptRegistry } from "../registry.js";
import {
  callArguments,
  callTargets,
  editsWorkspace,
  literalValue,
  NOT_LITERAL,
  scanOptionsValue,
  writesWorkspace,
} from "./script-literals.js";
import { sdkGlobals } from "./sdk-globals.js";
import { createSdkEnvironment, findSdkMethod } from "./sdk.js";
import {
  isOperationCheck,
  type MethodRisk,
  type NestedAuthorization,
} from "./sdk-types.js";
import { tokenize, type Token } from "./script-tokenizer.js";

/** One SDK call the scan found that policy checks as an operation. */
export type ScannedCall = {
  /** `<namespace>.<path>`, e.g. `jira.comments.add`. */
  operation: string;
  /** The call's own risk: the method's, or for raw requests GET `external_read` and anything else `destructive`. */
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
/** Namespaces whose calls are checked as direct tools (`web_fetch`, `read` / `write` / `edit`), not as operations. */
const DIRECT_PRODUCTS = new Set(["web", "files", "image"]);

const scanEnvironments = new WeakMap<
  QuickScriptRegistry,
  ReturnType<typeof createSdkEnvironment>
>();

/**
 * The operation checks of a call with literal arguments, from the method's own
 * `authorize`, so targets are normalized exactly as at run time. Undefined when
 * an argument is not literal or the method rejects the arguments.
 */
async function literalChecks(
  method: NonNullable<ReturnType<typeof findSdkMethod>>,
  args: Token[][],
  registry: QuickScriptRegistry,
): Promise<ScannedCall[] | undefined> {
  let values = args.map(literalValue);
  // Only the options that decide the authorization need to be literal (`mcp.tools.call`'s `server` and `tool`, not its `arguments`).
  if (values.includes(NOT_LITERAL) && method.scanOptions)
    values = [scanOptionsValue(args, method.scanOptions)];
  if (values.includes(NOT_LITERAL)) return undefined;
  try {
    let scanEnvironment = scanEnvironments.get(registry);
    if (!scanEnvironment) {
      scanEnvironment = createSdkEnvironment({ cwd: process.cwd(), registry });
      scanEnvironments.set(registry, scanEnvironment);
    }
    const prepared = await method.prepare(values, scanEnvironment);
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
export async function classifyQuickScriptScript(
  code: string,
  registry: QuickScriptRegistry,
): Promise<QuickScriptClassification> {
  const [division, regex] = [
    tokenize(code, "division"),
    tokenize(code, "regex"),
  ];
  const first = await classifyTokens(division, registry);
  if (JSON.stringify(division) === JSON.stringify(regex)) return first;
  // The readings disagree: report the riskier, and every operation either found.
  const second = await classifyTokens(regex, registry);
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

async function classifyTokens(
  tokens: Token[],
  registry: QuickScriptRegistry,
): Promise<QuickScriptClassification> {
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
    else if (DIRECT_PRODUCTS.has(method.product) || method.directTool)
      record(name, methodRisk, targets);
    else {
      // Literal arguments: the method's own authorization decides the risk (a raw request is an external read for GET, destructive otherwise).
      const checks = await literalChecks(method, args, registry);
      if (method.riskFromArgs && !checks) {
        record(`${name} (computed method)`, "destructive");
        continue;
      }
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
export async function classifyQuickScriptArguments(
  args: Record<string, unknown>,
  registry: QuickScriptRegistry,
): Promise<QuickScriptClassification> {
  return typeof args.code === "string"
    ? classifyQuickScriptScript(args.code, registry)
    : { risk: "destructive", operations: [], calls: [], admissible: false };
}
