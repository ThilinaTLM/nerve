import { parseOptions } from "@nervekit/extension-api";
import type {
  MethodAuthorization,
  MethodRisk,
  NestedCheck,
  SdkEnvironment,
  SdkMethod,
  SdkProduct,
} from "./sdk-types.js";

/** Small validators shared by SDK methods. */

/** Up to five candidates close to `input` (substring or small edit distance), best first. */
export function closeMatches(
  input: string,
  candidates: readonly string[],
  limit = 5,
): string[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ candidate: string; score: number }> = [];
  for (const candidate of new Set(candidates)) {
    const hay = candidate.toLowerCase();
    let score: number;
    if (hay === needle) score = 0;
    else if (hay.includes(needle) || needle.includes(hay)) score = 1;
    else {
      const distance = editDistance(needle, hay);
      if (distance > Math.max(2, Math.floor(needle.length / 3))) continue;
      score = 1 + distance;
    }
    scored.push({ candidate, score });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.candidate.length - b.candidate.length ||
        a.candidate.localeCompare(b.candidate),
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length];
}

type MethodBody<P> = {
  product: SdkProduct;
  path: string;
  risk: MethodRisk;
  signature: string;
  authorize?(parsed: P, env: SdkEnvironment): MethodAuthorization | undefined;
  authorizeAlso?(parsed: P, env: SdkEnvironment): MethodAuthorization[];
  /** Resource named by a 403; defaults to the authorization summary. */
  resource?(parsed: P): string;
  run(parsed: P, env: SdkEnvironment): Promise<unknown>;
};

/** An authorization as the executor's nested check: the operation defaults to `<namespace>.<method>`, the risk to the method's. */
export function toNestedCheck(
  authorization: MethodAuthorization,
  operation: string,
  risk: MethodRisk,
): NestedCheck {
  if ("toolName" in authorization) return authorization;
  return {
    operation: authorization.operation ?? operation,
    targets: authorization.targets.map((target) =>
      typeof target === "string" ? { kind: "resource", value: target } : target,
    ),
    risk: authorization.risk ?? risk,
    summary: authorization.summary,
  };
}

function build<P>(
  definition: MethodBody<P>,
  parse: (args: unknown[]) => P,
): SdkMethod {
  return {
    product: definition.product,
    path: definition.path,
    risk: definition.risk,
    signature: definition.signature,
    async prepare(args, env) {
      const parsed = parse(args);
      const operation = `${definition.product}.${definition.path}`;
      const declared = definition.authorize?.(parsed, env);
      const authorization =
        declared && toNestedCheck(declared, operation, definition.risk);
      return {
        authorization,
        additionalAuthorizations: definition
          .authorizeAlso?.(parsed, env)
          .map((also) => toNestedCheck(also, operation, definition.risk)),
        resource: definition.resource?.(parsed) ?? authorization?.summary ?? "",
        run: (env) => definition.run(parsed, env),
      };
    },
  };
}

/**
 * The calling convention: one argument, either a bare string (only when
 * `bare` names the string field it stands for) or an options object holding
 * the resource id under its single name. Unknown option names are rejected so
 * aliases from other APIs fail with the list of valid names.
 */
export function defineMethod<P>(
  definition: MethodBody<P> & {
    /** Option a bare string argument stands for, e.g. `key`. */
    bare?: string;
    /** Every accepted option name. */
    options: readonly string[];
    parse(options: Record<string, unknown>): P;
  },
): SdkMethod {
  const name = `${definition.product}.${definition.path}`;
  return build(definition, (args) =>
    definition.parse(
      parseOptions(name, args, {
        bare: definition.bare,
        options: definition.options,
      }),
    ),
  );
}

/** Positional exceptions (`files.*`, `request`), documented as such. */
export function definePositionalMethod<P>(
  definition: MethodBody<P> & {
    maxArgs: number;
    parse(args: unknown[]): P;
  },
): SdkMethod {
  const name = `${definition.product}.${definition.path}`;
  return build(definition, (args) => {
    if (args.length > definition.maxArgs) {
      throw new Error(
        `${name} takes at most ${definition.maxArgs} arguments, got ${args.length}.`,
      );
    }
    return definition.parse(args);
  });
}
