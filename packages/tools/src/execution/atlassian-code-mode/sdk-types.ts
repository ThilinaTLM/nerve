import type { ConfluenceConnection } from "../confluence/client.js";
import type {
  IntegrationExecutionContext,
  KrokiExecutionContext,
} from "../execution-context.js";
import type { JiraConnection } from "../jira/client.js";
import type { JiraFieldInfo } from "./jira-issue.js";

/** What a method is authorized as: the equivalent direct tool call. */
export type NestedAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  /** Short label for the record (JQL, issue key, ...). */
  summary: string;
};

/** Context type of the code-mode executor: integrations plus Kroki settings. */
export type CodeModeContext = IntegrationExecutionContext &
  KrokiExecutionContext;

/** A Confluence page written by the run, for the automatic lint report. */
export type PageReport = {
  action: "created" | "updated";
  id: string;
  title: string;
  version: number | null;
  fixes: string[];
  warnings: string[];
};

/** A file the run wrote to the conversation artifact folder. */
export type ArtifactReport = {
  /** `artifact:<name>` */
  handle: string;
  path: string;
  bytes: number;
  mediaType: string;
  /** Pixel size of PNG/JPEG artifacts, for previews. */
  width?: number;
  height?: number;
};

export type SdkEnvironment = {
  context: CodeModeContext;
  jira: () => Promise<JiraConnection>;
  confluence: () => Promise<ConfluenceConnection>;
  /** Jira field list, loaded once per script run. */
  jiraFields: () => Promise<JiraFieldInfo[]>;
  /** Confluence space keys by id, fetched lazily and cached per script run. */
  confluenceSpaceKeys: (ids: string[]) => Promise<Map<string, string>>;
  /** What the run produced; appended to the tool result automatically. */
  report: {
    pages: PageReport[];
    artifacts: Map<string, ArtifactReport>;
  };
};

export type SdkProduct = "jira" | "confluence" | "diagram" | "files" | "image";

export type PreparedCall = {
  /** The direct tool the call is checked as; absent for calls with no external effect (own artifacts). */
  authorization?: NestedAuthorization;
  /** Further direct-tool checks (e.g. `read` for a file path); all must pass before the call runs. */
  additionalAuthorizations?: NestedAuthorization[];
  /** What a 403 refers to, e.g. `project APP`. */
  resource: string;
  run: (env: SdkEnvironment) => Promise<unknown>;
};

export type SdkMethod = {
  product: SdkProduct;
  /** Dotted path under the product global, e.g. `issues.search`. */
  path: string;
  /** One-line signature for the guide. */
  signature: string;
  /**
   * Validates the script's arguments (throws on bad input) and returns what
   * the call is authorized as plus the implementation. The caller must
   * authorize before running.
   */
  prepare(args: unknown[], env: SdkEnvironment): PreparedCall;
};

type MethodBody<P> = {
  product: SdkProduct;
  path: string;
  signature: string;
  authorize?(parsed: P, env: SdkEnvironment): NestedAuthorization | undefined;
  authorizeAlso?(parsed: P, env: SdkEnvironment): NestedAuthorization[];
  /** Resource named by a 403; defaults to the authorization summary. */
  resource?(parsed: P): string;
  run(parsed: P, env: SdkEnvironment): Promise<unknown>;
};

function build<P>(
  definition: MethodBody<P>,
  parse: (args: unknown[]) => P,
): SdkMethod {
  return {
    product: definition.product,
    path: definition.path,
    signature: definition.signature,
    prepare(args, env) {
      const parsed = parse(args);
      const authorization = definition.authorize?.(parsed, env);
      return {
        authorization,
        additionalAuthorizations: definition.authorizeAlso?.(parsed, env),
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
