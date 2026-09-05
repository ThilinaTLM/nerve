const definitions = [
  ["contracts", "@nervekit/contracts", []],
  ["gpui-workbench", "@nervekit/gpui-workbench", []],
  ["native", "@nervekit/native", []],
  ["protocol", "@nervekit/protocol", ["@nervekit/contracts"]],
  ["harness", "@nervekit/harness", ["@nervekit/contracts", "@nervekit/native"]],
  ["tools", "@nervekit/tools", ["@nervekit/contracts", "@nervekit/native"]],
  ["ui-kit", "@nervekit/ui-kit", []],
  ["website", "@nervekit/website", []],
  [
    "workbench-server",
    "@nervekit/workbench-server",
    [
      "@nervekit/contracts",
      "@nervekit/native",
      "@nervekit/protocol",
      "@nervekit/harness",
      "@nervekit/tools",
    ],
  ],
  [
    "workbench-app",
    "@nervekit/workbench-app",
    ["@nervekit/contracts", "@nervekit/protocol", "@nervekit/ui-kit"],
  ],
  [
    "desktop-shell",
    "@nervekit/desktop-shell",
    ["@nervekit/contracts", "@nervekit/workbench-server"],
  ],
];

/** Canonical workspace package inventory and allowed internal dependencies. */
export const workspacePackages = definitions.map(
  ([directory, name, dependencies]) =>
    Object.freeze({
      directory,
      name,
      dependencies: Object.freeze(dependencies),
    }),
);

export const workspacePackageByName = new Map(
  workspacePackages.map((definition) => [definition.name, definition]),
);

export const workspacePackageByDirectory = new Map(
  workspacePackages.map((definition) => [definition.directory, definition]),
);

export const allowedNerveDependencies = new Map(
  workspacePackages.map((definition) => [
    definition.name,
    definition.dependencies,
  ]),
);
