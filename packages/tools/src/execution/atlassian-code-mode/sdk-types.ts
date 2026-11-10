import type { ConfluenceConnection } from "../confluence/client.js";
import type { IntegrationExecutionContext } from "../execution-context.js";
import type { JiraConnection } from "../jira/client.js";
import type { JiraFieldInfo } from "./jira-issue.js";

/** What a method is authorized as: the equivalent direct tool call. */
export type NestedAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  /** Short label for the record (JQL, issue key, ...). */
  summary: string;
};

export type SdkEnvironment = {
  context: IntegrationExecutionContext;
  jira: () => Promise<JiraConnection>;
  confluence: () => Promise<ConfluenceConnection>;
  /** Jira field list, loaded once per script run. */
  jiraFields: () => Promise<JiraFieldInfo[]>;
  /** Confluence space keys by id, fetched lazily and cached per script run. */
  confluenceSpaceKeys: (ids: string[]) => Promise<Map<string, string>>;
};

export type SdkProduct = "jira" | "confluence";

export type PreparedCall = {
  authorization: NestedAuthorization;
  run: (env: SdkEnvironment) => Promise<unknown>;
};

export type SdkMethod = {
  product: SdkProduct;
  /** Dotted path under the product global, e.g. `issues.search`. */
  path: string;
  /** One-line signature for the tool description. */
  signature: string;
  /**
   * Validates the script's arguments (throws on bad input) and returns what
   * the call is authorized as plus the implementation. The caller must
   * authorize before running.
   */
  prepare(args: unknown[]): PreparedCall;
};

export function defineMethod<P>(definition: {
  product: SdkProduct;
  path: string;
  signature: string;
  parse(args: unknown[]): P;
  authorize(parsed: P): NestedAuthorization;
  run(parsed: P, env: SdkEnvironment): Promise<unknown>;
}): SdkMethod {
  return {
    product: definition.product,
    path: definition.path,
    signature: definition.signature,
    prepare(args) {
      const parsed = definition.parse(args);
      return {
        authorization: definition.authorize(parsed),
        run: (env) => definition.run(parsed, env),
      };
    },
  };
}
