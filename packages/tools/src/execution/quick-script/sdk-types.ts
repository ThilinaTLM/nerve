import { ToolExecutionError } from "../errors/tool-error.js";
import type { ConfluenceConnection } from "../confluence/client.js";
import type {
  IntegrationExecutionContext,
  KrokiExecutionContext,
  WebExecutionContext,
} from "../execution-context.js";
import type { JiraConnection } from "../jira/client.js";
import type { JiraFieldInfo } from "./jira/issue.js";

/** What a method is authorized as: the equivalent direct tool call. */
export type NestedAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  /** Short label for the record (JQL, issue key, ...). */
  summary: string;
  /** Cannot be analysed (raw non-GET request): `toolName` supplies the deny rules only and an allow rule never admits it. */
  approvalRequired?: true;
};

/** The optional lookup was refused as unknown or unsupported (404/400); anything else, such as 401/403/5xx, is a real failure. */
const UNSUPPORTED_LOOKUP = [
  "JIRA_NOT_FOUND",
  "JIRA_BAD_REQUEST",
  "CONFLUENCE_NOT_FOUND",
  "CONFLUENCE_BAD_REQUEST",
];

/** `.catch` handler for an optional lookup: `fallback` when the API says it is not there or not supported, otherwise rethrows. */
export function orWhenUnsupported<T>(fallback: () => T | Promise<T>) {
  return (error: unknown): T | Promise<T> => {
    if (
      error instanceof ToolExecutionError &&
      UNSUPPORTED_LOOKUP.includes(error.code)
    )
      return fallback();
    throw error;
  };
}

/** Context type of the quick-script executor: integrations plus Kroki settings. */
export type QuickScriptContext = IntegrationExecutionContext &
  KrokiExecutionContext &
  WebExecutionContext;

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
  context: QuickScriptContext;
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
    /** Entities the run created, listed in the footer for follow-up and cleanup: `SCRUM-6`, `comment 10023 on SCRUM-6`, `sprint 5`. Pages are reported in `pages`. */
    created: string[];
    /** Existing entities the run changed in a way that is not a creation: `attachment 77 on page 5 (new version)`. Use the same label as `created`/`deleted` for the same entity. */
    updated: string[];
    /** Entities the run deleted, with the same labels as `created` (an entity created and deleted in one run is shown once, as deleted). */
    deleted: string[];
    /** Raw non-GET requests (`POST /rest/api/3/issue`); recorded by the executor, not by methods. */
    raw: string[];
  };
};

export type SdkProduct =
  | "atlassian"
  | "jira"
  | "confluence"
  | "diagram"
  | "files"
  | "image"
  | "web";

export type PreparedCall = {
  /** The direct tool the call is checked as; absent for calls with no external effect (own artifacts). */
  authorization?: NestedAuthorization;
  /** Further direct-tool checks (e.g. `read` for a file path); all must pass before the call runs. */
  additionalAuthorizations?: NestedAuthorization[];
  /** What a 403 refers to, e.g. `project APP`. */
  resource: string;
  run: (env: SdkEnvironment) => Promise<unknown>;
};

/**
 * What a method can do at most: `none` has no external effect, `read` reads local data, `network` reads through an integration, `write` changes workspace files, `external_write` changes things in an integration, `destructive` deletes or is not analysable (`request`).
 * It must not be lower than the risk of the direct tool call the method is
 * authorized as; the executor refuses to run a method that violates this.
 */
export type MethodRisk =
  | "none"
  | "read"
  | "network"
  | "write"
  | "external_write"
  | "destructive";

export type SdkMethod = {
  product: SdkProduct;
  /** Dotted path under the product global, e.g. `issues.search`. */
  path: string;
  /** Upper bound of the method's effect; the script scanner and the runtime ceiling start from it. */
  risk: MethodRisk;
  /** TypeScript method declaration, optionally led by a one-line JSDoc comment; generates the guide's `references/*.d.ts` (sdk-dts.ts). */
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
  risk: MethodRisk;
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
    risk: definition.risk,
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
