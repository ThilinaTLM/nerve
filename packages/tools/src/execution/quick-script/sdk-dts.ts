import {
  ATLASSIAN_DTS_TYPES,
  CONFLUENCE_DTS_TYPES,
  FILES_DTS_TYPES,
  IMAGE_CHAIN_OPS,
  JIRA_DTS_TYPES,
  WEB_DTS_TYPES,
} from "./sdk-dts-types.js";
import type { SdkMethod, SdkProduct } from "./sdk-types.js";

/**
 * Generates the guide's `references/*.d.ts` from the method tables: each
 * method's `signature` is a TypeScript method declaration, optionally preceded
 * by a one-line JSDoc comment. Overloads are joined with `; ` in one signature.
 */

const header = (file: string) =>
  `// GENERATED from the method tables (sdk-dts.test.ts); regenerate with UPDATE_SDK_DTS=1.\n// ${file}: sandbox globals and the shapes they return.\n`;

function member(method: SdkMethod, indent: string): string[] {
  const name = method.path.split(".").pop() as string;
  const match = /^(?:\/\*\*\s*(.*?)\s*\*\/\s*)?([\s\S]*)$/.exec(
    method.signature,
  );
  const doc = match?.[1];
  const declaration = match?.[2] ?? "";
  if (!declaration.startsWith(`${name}(`)) {
    throw new Error(
      `${method.product}.${method.path}: signature must declare ${name}(...)`,
    );
  }
  return [
    ...(doc ? [`${indent}/** ${doc} */`] : []),
    ...declaration
      .split(new RegExp(`;\\s*(?=${name}\\()`))
      .map((overload) => `${indent}${overload.replace(/;$/, "")};`),
  ];
}

/** `jira.issues.search` becomes `issues: { search(...) }`; ungrouped methods sit directly on the global. */
function objectBody(methods: SdkMethod[]): string[] {
  const groups = new Map<string, SdkMethod[]>();
  const direct: SdkMethod[] = [];
  for (const method of methods) {
    const group = method.path.split(".").slice(0, -1).join(".");
    if (!group) direct.push(method);
    else groups.set(group, [...(groups.get(group) ?? []), method]);
  }
  return [
    ...[...groups].flatMap(([group, entries]) => [
      `  ${group}: {`,
      ...entries.flatMap((entry) => member(entry, "    ")),
      "  };",
    ]),
    ...direct.flatMap((entry) => member(entry, "  ")),
  ];
}

/** File name (e.g. `jira.d.ts`) to content. */
export function generateSdkDts(methods: SdkMethod[]): Record<string, string> {
  const of = (product: SdkProduct) =>
    methods.filter((m) => m.product === product);
  const globalObject = (product: SdkProduct) => [
    `declare const ${product}: {`,
    ...objectBody(of(product)),
    "};",
  ];
  const file = (name: string, parts: string[]) =>
    [`${header(name)}`, ...parts, ""].join("\n");
  return {
    "jira.d.ts": file("jira.d.ts", [
      JIRA_DTS_TYPES,
      "",
      ...globalObject("jira"),
    ]),
    "confluence.d.ts": file("confluence.d.ts", [
      CONFLUENCE_DTS_TYPES,
      "",
      ...globalObject("confluence"),
    ]),
    "atlassian.d.ts": file("atlassian.d.ts", [
      ATLASSIAN_DTS_TYPES,
      "",
      ...globalObject("atlassian"),
    ]),
    "web.d.ts": file("web.d.ts", [WEB_DTS_TYPES, "", ...globalObject("web")]),
    "files.d.ts": file("files.d.ts", [
      FILES_DTS_TYPES,
      "",
      ...globalObject("files"),
      "",
      ...globalObject("diagram"),
      "",
      "/** Chain over the native image module; the bytes never enter the script. */",
      "interface ImageChain {",
      IMAGE_CHAIN_OPS,
      ...of("image").flatMap((method) => member(method, "  ")),
      "}",
      "declare function image(handle: FileHandle): ImageChain;",
    ]),
  };
}
