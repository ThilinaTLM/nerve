import { ToolExecutionError } from "../../execution/index.js";
import type { ExtensionHostPorts } from "../extension-host/ports.js";
import type { ExtensionRuntime } from "../extension-host/runtime.js";
import type { QuickScriptRegistry } from "../registry.js";
import type { KrokiToolSettings } from "@nervekit/contracts/settings";
import type {
  IntegrationExecutionContext,
  WebExecutionContext,
} from "../../execution/index.js";

/*
 * Shapes the runtime context and environment carry for the built-in extensions.
 * TEMPORARY until docs/proposals/extension-platform phase 1 step 3: they move to the extensions.
 */

export type JiraConnection = {
  siteUrl: string;
  email: string;
  token: string;
  defaultProjectKey?: string;
};

export type ConfluenceConnection = {
  siteUrl: string;
  email: string;
  token: string;
  defaultSpaceKey?: string;
};

export type JiraFieldInfo = {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
  /** Element type of array fields, e.g. `option`, `user`, `version`. */
  items?: string | null;
  /** Custom field type, e.g. `...:textarea`; system field name otherwise. */
  kind?: string | null;
};

export type ImagegenBackend = "openai-codex";

/** The resolved `imagegen` extension settings the host puts in the execution context. */
export type ImagegenSettings = {
  backend: ImagegenBackend;
  model: string;
  quality: string;
  size: string;
  background: string;
};

/** What the host's backend adapter executes: every option is final (call overrides applied). */
export type ImageBackendRequest = {
  backend: "openai-codex";
  model: string;
  quality: string;
  size: string;
  background: string;
};

export type ImageGenerateRequest = {
  prompt: string;
  /** Reference images; only backends that accept them get any. */
  inputs: { data: Uint8Array; mimeType: string }[];
  options: ImageBackendRequest;
  signal?: AbortSignal;
};

export type ImageGenerateResponse = {
  provider: string;
  model: string;
  images: Array<{ data: Uint8Array; revisedPrompt?: string }>;
};

/** A resource a call acts on, normalized `<system>:<type>/<id>`: `jira:issue/APP-12`, `confluence:page/123`, `jira:request/GET /rest/api/3/myself`. */
export type OperationTarget = { kind: "resource"; value: string };

/** What the policy checks for a call: the operation, the resources it acts on and its risk. */
export type NestedAuthorization = {
  /** `<namespace>.<path>`, e.g. `jira.issues.create`. */
  operation: string;
  targets: OperationTarget[];
  /** The method's declared risk, or the call's own risk (raw requests). */
  risk: MethodRisk;
  /** Short label for the record (JQL, issue key, ...). */
  summary: string;
};

/** A call authorized as a direct tool that remains (`web_fetch`, `read`/`write`/`edit` for files). */
export type DirectAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
};

/** A check on a prepared call: an operation or a remaining direct tool. */
export type NestedCheck = NestedAuthorization | DirectAuthorization;

/** What a method returns from `authorize`; the operation and risk default to the method's. */
export type MethodAuthorization =
  | DirectAuthorization
  | (Pick<NestedAuthorization, "summary"> &
      Partial<Pick<NestedAuthorization, "operation" | "risk">> & {
        targets: readonly (OperationTarget | string)[];
      });

export function isOperationCheck(
  check: NestedCheck,
): check is NestedAuthorization {
  return "operation" in check;
}

/** `operation · target, target`, as shown in approvals, errors and records. */
export function describeCheck(check: NestedCheck): string {
  if (!isOperationCheck(check)) return check.toolName;
  return [check.operation, check.targets.map((t) => t.value).join(", ")]
    .filter(Boolean)
    .join(" · ");
}

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

/** Kroki server of the `diagram` extension. */
export interface KrokiExecutionContext {
  kroki?: KrokiToolSettings;
}

/** Image generation: the resolved `imagegen` settings and the host's backend adapter. */
export interface ImageGenerationExecutionContext {
  imagegen?: Partial<ImagegenSettings>;
  generateImage?: (
    request: ImageGenerateRequest,
  ) => Promise<ImageGenerateResponse>;
}

/** The extension host's ports and the registry this run serves. */
export interface ExtensionExecutionContext {
  /** Registry of the extensions this run serves; the host passes the one it composed. */
  registry?: QuickScriptRegistry;
  /** How the runtime reaches settings, accounts and model backends for extensions built on the extension API. */
  extensionPorts?: ExtensionHostPorts;
}

/** Context type of the quick-script executor: integrations plus the extensions' settings and host adapters. */
export type QuickScriptContext = IntegrationExecutionContext &
  ExtensionExecutionContext &
  KrokiExecutionContext &
  ImageGenerationExecutionContext &
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
  /** Extension API runtime of this run: `ctx` per extension and namespace sessions. */
  extensions: ExtensionRuntime;
  /** The registry of this run. */
  registry: QuickScriptRegistry;
  /** Characters of `sdk.*` text returned so far; discovery shares one budget per run. */
  discovery: { used: number };
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
    /** Free-text lines extensions add through `ctx.report.note`. */
    notes: string[];
  };
};

/** A namespace id: the global a method lives on (`jira`, `files`, `sdk`). */
export type SdkProduct = string;

export type PreparedCall = {
  /** What the call is checked as; absent for calls with no external effect (own artifacts). */
  authorization?: NestedCheck;
  /** Further checks (e.g. direct `read` for a file path); all must pass before the call runs. */
  additionalAuthorizations?: NestedCheck[];
  /** What a 403 refers to, e.g. `project APP`. */
  resource: string;
  run: (env: SdkEnvironment) => Promise<unknown>;
};

/**
 * What a method can do at most: `none` has no external effect, `read` reads local data, `network` reads through an integration, `write` changes workspace files, `external_write` changes things in an integration, `destructive` deletes or is not analysable (`request`).
 * It must not be lower than the risk of the check the method runs; the executor refuses to run a method that violates this.
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
  /** TypeScript method declaration, optionally led by a one-line JSDoc comment; generates the declarations `sdk.describe` serves (sdk-dts.ts). */
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
  authorize?(parsed: P, env: SdkEnvironment): MethodAuthorization | undefined;
  authorizeAlso?(parsed: P, env: SdkEnvironment): MethodAuthorization[];
  /** Resource named by a 403; defaults to the authorization summary. */
  resource?(parsed: P): string;
  run(parsed: P, env: SdkEnvironment): Promise<unknown>;
};

function resolveAuthorization(
  method: { product: string; path: string; risk: MethodRisk },
  authorization: MethodAuthorization,
): NestedCheck {
  if ("toolName" in authorization) return authorization;
  return {
    operation: authorization.operation ?? `${method.product}.${method.path}`,
    targets: authorization.targets.map((target) =>
      typeof target === "string" ? { kind: "resource", value: target } : target,
    ),
    risk: authorization.risk ?? method.risk,
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
    prepare(args, env) {
      const parsed = parse(args);
      const declared = definition.authorize?.(parsed, env);
      const authorization =
        declared && resolveAuthorization(definition, declared);
      return {
        authorization,
        additionalAuthorizations: definition
          .authorizeAlso?.(parsed, env)
          .map((also) => resolveAuthorization(definition, also)),
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
