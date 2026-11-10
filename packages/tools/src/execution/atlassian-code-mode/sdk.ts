import type { IntegrationExecutionContext } from "../execution-context.js";
import {
  confluenceConnectionLoader,
  confluenceMethods,
  confluenceSpaceKeyLoader,
} from "./confluence-methods.js";
import {
  createJiraFieldLoader,
  jiraConnectionLoader,
  jiraMethods,
} from "./jira-methods.js";
import type { SdkEnvironment, SdkMethod } from "./sdk-types.js";
import { STORAGE_INDEX, STORAGE_PRELUDE } from "./storage-helpers.js";

/**
 * The SDK in one place. Every method (jira-methods.ts, confluence-methods.ts)
 * declares its signature, the direct tool it is authorized as, and its
 * implementation. The prelude injected into the sandbox and the tool
 * description's SDK index are both generated from these tables, so docs cannot
 * drift from the dispatcher.
 */

export type {
  NestedAuthorization,
  SdkEnvironment,
  SdkMethod,
} from "./sdk-types.js";

const methods: SdkMethod[] = [...jiraMethods, ...confluenceMethods];

const methodByName = new Map<string, SdkMethod>(
  methods.map((method) => [`${method.product}.${method.path}`, method]),
);

export function findSdkMethod(name: string): SdkMethod | undefined {
  return methodByName.get(name);
}

export function sdkMethodNames(): string[] {
  return [...methodByName.keys()];
}

export function createSdkEnvironment(
  context: IntegrationExecutionContext,
): SdkEnvironment {
  const jira = jiraConnectionLoader(context);
  const confluence = confluenceConnectionLoader(context);
  return {
    context,
    jira,
    confluence,
    jiraFields: createJiraFieldLoader(context, jira),
    confluenceSpaceKeys: confluenceSpaceKeyLoader(context, confluence),
  };
}

/** `jira.issues.get = (...args) => host.call("jira.issues.get", args)`, nested by group. */
function productPrelude(product: string): string {
  const groups = new Map<string, string[]>();
  for (const method of methods.filter((m) => m.product === product)) {
    const [group, name] = method.path.split(".") as [string, string];
    const entries = groups.get(group) ?? [];
    entries.push(
      `    ${name}: (...args) => host.call("${product}.${method.path}", args),`,
    );
    groups.set(group, entries);
  }
  const body = [...groups]
    .map(([group, entries]) => `  ${group}: {\n${entries.join("\n")}\n  },`)
    .join("\n");
  return `globalThis.${product} = {\n${body}\n};`;
}

/** Trusted prelude: `jira.*`/`confluence.*` forward positional args to `host.call`; `storage.*` is pure JS. */
export const SDK_PRELUDE = [
  productPrelude("jira"),
  productPrelude("confluence"),
  STORAGE_PRELUDE,
].join("\n");

function index(product: string): string {
  return methods
    .filter((method) => method.product === product)
    .map((method) => `${product}.${method.signature}`)
    .join("\n");
}

/** Compact SDK index for the tool description. */
export const SDK_INDEX = {
  jira: index("jira"),
  confluence: index("confluence"),
  storage: STORAGE_INDEX,
};
