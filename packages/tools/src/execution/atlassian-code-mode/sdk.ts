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
import { diagramMethods } from "./diagram-methods.js";
import type {
  CodeModeContext,
  SdkEnvironment,
  SdkMethod,
} from "./sdk-types.js";
import { STORAGE_PRELUDE } from "./storage-helpers.js";

/**
 * The SDK in one place. Every method (jira-methods.ts, confluence-methods.ts)
 * declares its signature, the direct tool it is authorized as, and its
 * implementation. The prelude injected into the sandbox is generated from
 * these tables; the guide skill's references are checked against them by
 * guide-coverage.test.ts.
 */

export type {
  SdkEnvironment,
  SdkMethod,
} from "./sdk-types.js";

const methods: SdkMethod[] = [
  ...jiraMethods,
  ...confluenceMethods,
  ...diagramMethods,
];

const methodByName = new Map<string, SdkMethod>(
  methods.map((method) => [`${method.product}.${method.path}`, method]),
);

export function findSdkMethod(name: string): SdkMethod | undefined {
  return methodByName.get(name);
}

export function sdkMethodNames(): string[] {
  return [...methodByName.keys()];
}

export function createSdkEnvironment(context: CodeModeContext): SdkEnvironment {
  const jira = jiraConnectionLoader(context);
  const confluence = confluenceConnectionLoader(context);
  return {
    context,
    files: new Map(),
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
    const parts = method.path.split(".");
    const name = parts.pop()!;
    const group = parts.join(".");
    const entries = groups.get(group) ?? [];
    entries.push(
      `${name}: (...args) => host.call("${product}.${method.path}", args),`,
    );
    groups.set(group, entries);
  }
  const body = [...groups]
    .map(([group, entries]) =>
      group
        ? `  ${group}: {\n    ${entries.join("\n    ")}\n  },`
        : `  ${entries.join("\n  ")}`,
    )
    .join("\n");
  return `globalThis.${product} = {\n${body}\n};`;
}

/** Trusted prelude: `jira.*`/`confluence.*` forward positional args to `host.call`; `storage.*` is pure JS. */
export const SDK_PRELUDE = [
  productPrelude("jira"),
  productPrelude("confluence"),
  productPrelude("diagram"),
  STORAGE_PRELUDE,
].join("\n");
