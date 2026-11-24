import type { ExtensionAgentPort } from "../../extension-host/agent-port.js";
import type { LaunchesAgentPort } from "./launches/launches-port.js";
import type { McpAgentPort } from "./mcp/mcp-port.js";
import type { ConfigurationAgentPort } from "./configuration/configuration-port.js";
import type { ExtensionHostPorts } from "../../extension-host/ports.js";
import type { ExtensionCodeAdapter } from "../../extension-host/code-adapter.js";
import type { ExtensionRuntime } from "../../extension-host/runtime.js";
import type { QuickScriptRegistry } from "../registry.js";
import type {
  IntegrationExecutionContext,
  WebExecutionContext,
} from "../../execution/index.js";

/* Shapes the runtime context and environment carry for the extensions' calls. */

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

/** The extension host's ports and the registry this run serves. */
export interface ExtensionExecutionContext {
  /** Registry of the extensions this run serves; the host passes the one it composed. */
  registry?: QuickScriptRegistry;
  /** How the runtime reaches settings, accounts and model backends for extensions built on the extension API. */
  extensionPorts?: ExtensionHostPorts;
  /** Reload and status of the project's installed extensions (`extensions.*`); absent: the namespace fails with FORBIDDEN. */
  extensionAgent?: ExtensionAgentPort;
  /** Check and reload of the configuration files (`configuration.*`); absent: the namespace fails with FORBIDDEN. */
  configurationAgent?: ConfigurationAgentPort;
  /** The project's launch catalog (`launches.*`); absent: the namespace fails with FORBIDDEN. */
  launchesAgent?: LaunchesAgentPort;
  /** The user's MCP servers (`mcp.*`); absent: the namespace fails with FORBIDDEN. */
  mcpAgent?: McpAgentPort;
  /** How the host reaches extension code; absent: in the host process. */
  extensionCodeAdapter?: ExtensionCodeAdapter;
  /** Set while an extension's direct tool runs: streams into a live view section; false when the section is not live. */
  toolProgress?: (section: string, chunk: string) => boolean;
}

/** Context type of the quick-script executor: integrations plus the extensions' settings and host adapters. */
export type QuickScriptContext = IntegrationExecutionContext &
  ExtensionExecutionContext &
  WebExecutionContext;

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
  /** Extension API runtime of this run: `ctx` per extension and namespace sessions. */
  extensions: ExtensionRuntime;
  /** The registry of this run. */
  registry: QuickScriptRegistry;
  /** Characters of `sdk.*` text returned so far; discovery shares one budget per run. */
  discovery: { used: number };
  /** What the run produced; appended to the tool result automatically. */
  report: {
    artifacts: Map<string, ArtifactReport>;
    /** Entities the run created, listed in the footer for follow-up and cleanup: `SCRUM-6`, `comment 10023 on SCRUM-6`, `sprint 5`. */
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
 * What a method can do at most: `none` has no external effect, `read` reads local data, `external_read` reads through an integration, `write` changes workspace files, `external_write` changes things in an integration, `destructive` deletes or is not analysable (`request`).
 * It must not be lower than the risk of the check the method runs; the executor refuses to run a method that violates this.
 */
export type MethodRisk =
  | "none"
  | "read"
  | "external_read"
  | "write"
  | "external_write"
  | "destructive";

export type SdkMethod = {
  product: SdkProduct;
  /** Dotted path under the product global, e.g. `issues.search`. */
  path: string;
  /** Upper bound of the method's effect; the script scanner and the runtime ceiling start from it. */
  risk: MethodRisk;
  /** The risk depends on argument values; the scanner needs literal arguments to decide it (see `MethodDefinition.riskFromArgs`). */
  riskFromArgs?: boolean;
  /**
   * Options that alone decide the method's authorization (operation, targets, risk). The scan
   * reads them from an object literal and passes every other option as `null`, so a call whose
   * other options are computed (`mcp.tools.call`'s `arguments`) still names its targets.
   */
  scanOptions?: readonly string[];
  /** Checked as this direct tool at run time (`launches.start` as `bash`), not as an operation; operation rules cannot admit it. */
  directTool?: string;
  /** TypeScript method declaration, optionally led by a one-line JSDoc comment; generates the declarations `sdk.describe` serves (sdk-dts.ts). */
  signature: string;
  /**
   * Validates the script's arguments (throws on bad input) and returns what
   * the call is authorized as plus the implementation. The caller must
   * authorize before running.
   */
  prepare(args: unknown[], env: SdkEnvironment): Promise<PreparedCall>;
};
