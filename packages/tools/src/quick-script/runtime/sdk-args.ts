import { parseOptions } from "@nervekit/extension-api/host";
import type {
  MethodAuthorization,
  MethodRisk,
  NestedCheck,
  SdkEnvironment,
  SdkMethod,
  SdkProduct,
} from "./sdk-types.js";

/** Small validators shared by SDK methods. */

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
