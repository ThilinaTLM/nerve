import { atlassianMethods } from "./atlassian/defaults.js";
import {
  confluenceConnectionLoader,
  confluenceMethods,
  confluenceSpaceKeyLoader,
} from "./confluence/methods.js";
import { diagramMethods } from "./files/diagram-methods.js";
import { filesMethods } from "./files/files-methods.js";
import { imageMethods } from "./files/image-methods.js";
import {
  createJiraFieldLoader,
  jiraConnectionLoader,
  jiraMethods,
} from "./jira/methods.js";
import { librariesPrelude } from "./libraries.js";
import { RUNTIME_HEAD, RUNTIME_TAIL } from "./runtime-prelude.js";
import type {
  QuickScriptContext,
  SdkEnvironment,
  SdkMethod,
} from "./sdk-types.js";
import { STORAGE_PRELUDE } from "./files/storage-helpers.js";
import { webMethods } from "./web/web-methods.js";

/**
 * The SDK in one place. Every method declares its signature, the direct tool
 * it is authorized as, and its implementation. The prelude injected into the
 * sandbox is generated from these tables; the guide skill's references are
 * checked against them by guide-coverage.test.ts.
 */

export type { SdkEnvironment, SdkMethod } from "./sdk-types.js";

const methods: SdkMethod[] = [
  ...atlassianMethods,
  ...jiraMethods,
  ...confluenceMethods,
  ...diagramMethods,
  ...filesMethods,
  ...imageMethods,
  ...webMethods,
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

export function createSdkEnvironment(
  context: QuickScriptContext,
): SdkEnvironment {
  const jira = jiraConnectionLoader(context);
  const confluence = confluenceConnectionLoader(context);
  return {
    context,
    jira,
    confluence,
    jiraFields: createJiraFieldLoader(context, jira),
    confluenceSpaceKeys: confluenceSpaceKeyLoader(context, confluence),
    report: { pages: [], artifacts: new Map(), created: [] },
  };
}

/** `jira.issues.get = (...args) => call("jira.issues.get", args)`, nested by group. */
function productPrelude(product: string): string {
  const groups = new Map<string, string[]>();
  for (const method of methods.filter((m) => m.product === product)) {
    const parts = method.path.split(".");
    const name = parts.pop()!;
    const group = parts.join(".");
    const entries = groups.get(group) ?? [];
    entries.push(
      `${name}: (...args) => call("${product}.${method.path}", args),`,
    );
    groups.set(group, entries);
  }
  const body = [...groups]
    .map(([group, entries]) =>
      group
        ? `    ${group}: {\n      ${entries.join("\n      ")}\n    },`
        : `    ${entries.join("\n    ")}`,
    )
    .join("\n");
  return `  globalThis.${product} = {\n${body}\n  };`;
}

/** Trusted prelude: SDK objects forwarding to `host.call`, plus the pure-JS `storage.*` builders. */
export const SDK_PRELUDE = [
  `(() => {\n${RUNTIME_HEAD}`,
  ...[
    "atlassian",
    "jira",
    "confluence",
    "diagram",
    "files",
    "image",
    "web",
  ].map(productPrelude),
  `${RUNTIME_TAIL}})();`,
  STORAGE_PRELUDE,
].join("\n");

/** Everything evaluated before the module: the SDK, plus lazy libraries the script mentions. */
export function preludesFor(
  code: string,
): Array<{ name: string; source: string }> {
  const libraries = librariesPrelude(code);
  return [
    { name: "nerve:atlassian-sdk", source: SDK_PRELUDE },
    ...(libraries ? [{ name: "nerve:libraries", source: libraries }] : []),
  ];
}

/**
 * Wraps the script so a top-level `return value` works while top-level `await`
 * keeps working: the body becomes an async function whose result is printed.
 * The wrapper opens on the script's first line, so reported line numbers match.
 */
export function wrapScript(code: string): string {
  return `__nerveReturn(await (async () => {${code}\n})());`;
}
