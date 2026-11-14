import {
  ExtensionError,
  method,
  type Authorization,
  type MethodDefinition,
  type Risk,
} from "@nervekit/extension-api";
import { AtlassianApiError } from "./errors.js";

/*
 * The calling convention of the Atlassian methods on top of the extension
 * API's `method()`: one argument, either a bare string (only when `bare` names
 * the string field it stands for) or an options object, and Atlassian
 * failures that read `SCRUM-9: <the service's message>`.
 */

type MethodBody<P, S> = {
  /** Namespace id, for messages (`jira`). */
  product: string;
  /** Dotted path under the namespace, e.g. `issues.search`. */
  path: string;
  risk: Risk;
  /** The risk depends on argument values (raw requests); see `MethodDefinition.riskFromArgs`. */
  riskFromArgs?: boolean;
  signature: string;
  authorize?(parsed: P): Authorization | undefined;
  /** Further checks (a workspace file the method reads); all must pass. */
  authorizeAlso?(parsed: P): Authorization[];
  /** What a 403 refers to, e.g. `project APP`; defaults to the authorization summary. */
  resource?(parsed: P): string;
  run(parsed: P, session: S): Promise<unknown>;
};

/** A method with the path it is registered under in its namespace. */
export type PathedMethod<S> = {
  path: string;
  definition: MethodDefinition<S, unknown, unknown>;
};

const BAD_TIME = /time ?logged|time duration|worklog must not be null/i;
const BAD_TIME_HINT =
  'time must look like "1h 30m" (units w, d, h, m; e.g. "2d", "45m").';

/** The name an error is about: `issue SCRUM-9` is `SCRUM-9`; generic resources get no prefix. */
function subject(resource: string): string | undefined {
  if (!resource || /^(this )?(Jira|Confluence)\b|^space /.test(resource))
    return undefined;
  return resource.replace(/^issue /, "");
}

/** Jira and Confluence failures read `SCRUM-9: <the service's message>` instead of the transport text with method, path and status. */
function tidy(error: unknown, resource: string, path: string): unknown {
  if (!(error instanceof AtlassianApiError)) return error;
  const reason = error.reason?.trim();
  const message =
    path.startsWith("worklogs.") && reason && BAD_TIME.test(reason)
      ? BAD_TIME_HINT
      : reason || `HTTP ${error.status}`;
  const prefix = subject(resource);
  return new ExtensionError(
    error.code,
    prefix ? `${prefix}: ${message}` : message,
  );
}

function build<P, S>(
  definition: MethodBody<P, S>,
  parse: (args: readonly unknown[]) => P,
): PathedMethod<S> {
  const authorizations = (parsed: P): Authorization[] => {
    const main = definition.authorize?.(parsed);
    return [
      ...(main ? [main] : []),
      ...(definition.authorizeAlso?.(parsed) ?? []),
    ];
  };
  const resourceOf = (parsed: P): string =>
    definition.resource?.(parsed) ??
    definition.authorize?.(parsed)?.summary ??
    "";
  return {
    path: definition.path,
    definition: method<P, unknown, S>({
      risk: definition.risk,
      ...(definition.riskFromArgs ? { riskFromArgs: true } : {}),
      signature: definition.signature,
      parse,
      authorize: authorizations,
      resource: resourceOf,
      run: async (session, parsed) => {
        try {
          return await definition.run(parsed, session);
        } catch (error) {
          // The raw `request` keeps the full transport message.
          throw definition.path === "request"
            ? error
            : tidy(error, resourceOf(parsed), definition.path);
        }
      },
    }) as MethodDefinition<S, unknown, unknown>,
  };
}

/**
 * The calling convention: one argument, either a bare string (only when
 * `bare` names the string field it stands for) or an options object holding
 * the resource id under its single name. Unknown option names are rejected so
 * aliases from other APIs fail with the list of valid names.
 */
export function defineMethod<P, S>(
  definition: MethodBody<P, S> & {
    /** Option a bare string argument stands for, e.g. `key`. */
    bare?: string;
    /** Every accepted option name. */
    options: readonly string[];
    parse(options: Record<string, unknown>): P;
  },
): PathedMethod<S> {
  const name = `${definition.product}.${definition.path}`;
  return build(definition, (args) => {
    if (args.length > 1) {
      throw new Error(
        `${name} takes one argument (${definition.bare ? `a ${definition.bare} string or ` : ""}an options object), got ${args.length}.`,
      );
    }
    const [first] = args;
    let options: Record<string, unknown>;
    if (first === undefined || first === null) options = {};
    else if (typeof first === "string" || typeof first === "number") {
      if (!definition.bare) {
        throw new Error(
          `${name} takes an options object: { ${definition.options.join(", ")} }.`,
        );
      }
      options = { [definition.bare]: String(first) };
    } else if (typeof first === "object" && !Array.isArray(first)) {
      options = first as Record<string, unknown>;
    } else {
      throw new Error(`${name} takes an options object.`);
    }
    const unknown = Object.keys(options).filter(
      (key) => !definition.options.includes(key),
    );
    if (unknown.length > 0) {
      throw new Error(
        `${name} has no option '${unknown[0]}'; valid options: ${definition.options.join(", ")}.`,
      );
    }
    return definition.parse(options);
  });
}

/** Positional exceptions (`request`, `adf.*`), documented as such. */
export function definePositionalMethod<P, S>(
  definition: MethodBody<P, S> & {
    maxArgs: number;
    parse(args: unknown[]): P;
  },
): PathedMethod<S> {
  const name = `${definition.product}.${definition.path}`;
  return build(definition, (args) => {
    if (args.length > definition.maxArgs) {
      throw new Error(
        `${name} takes at most ${definition.maxArgs} arguments, got ${args.length}.`,
      );
    }
    return definition.parse([...args]);
  });
}

/** A namespace's method table, in declaration order (the order `sdk.describe` lists them). */
export function methodTable<S>(
  methods: readonly PathedMethod<S>[],
): Record<string, MethodDefinition<S, unknown, unknown>> {
  return Object.fromEntries(
    methods.map(({ path, definition }) => [path, definition]),
  );
}
