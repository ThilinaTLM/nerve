/**
 * Allowed internal dependency edges between workspace packages (policy data).
 * The package inventory itself (names, directories, actual dependencies) is
 * derived from `packages/*\/package.json`; only the *allowed* edges live here.
 * Keys and values are package names; a package may not declare or import any
 * other `@nervekit/*` package.
 */
export const ALLOWED_INTERNAL_DEPENDENCIES: ReadonlyMap<
  string,
  readonly string[]
> = new Map([
  ["@nervekit/extension-api", []],
  ["@nervekit/contracts", ["@nervekit/extension-api"]],
  ["@nervekit/native", []],
  ["@nervekit/protocol", ["@nervekit/contracts"]],
  ["@nervekit/harness", ["@nervekit/contracts", "@nervekit/native"]],
  [
    "@nervekit/tools",
    ["@nervekit/contracts", "@nervekit/native", "@nervekit/extension-api"],
  ],
  ["@nervekit/extensions", ["@nervekit/extension-api"]],
  [
    "@nervekit/conversation-core",
    [
      "@nervekit/contracts",
      "@nervekit/native",
      "@nervekit/harness",
      "@nervekit/tools",
    ],
  ],
  ["@nervekit/ui-kit", []],
  ["@nervekit/website", []],
  [
    "@nervekit/workbench-server",
    [
      "@nervekit/contracts",
      "@nervekit/native",
      "@nervekit/protocol",
      "@nervekit/harness",
      "@nervekit/tools",
      "@nervekit/extension-api",
      "@nervekit/extensions",
      "@nervekit/conversation-core",
    ],
  ],
  [
    "@nervekit/workbench-app",
    ["@nervekit/contracts", "@nervekit/protocol", "@nervekit/ui-kit"],
  ],
  [
    "@nervekit/desktop-shell",
    ["@nervekit/contracts", "@nervekit/workbench-server"],
  ],
]);
