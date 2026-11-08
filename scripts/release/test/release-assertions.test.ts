import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDistributionDependencies,
  nativeOptionalDependencies,
  nativePlatformManifest,
} from "../npm-manifests.ts";
import { nativePlatformPackage } from "../native-prebuilds.ts";
import {
  bundleOutputFiles,
  thirdPartyPackageRoots,
} from "../bundle-desktop.ts";
import {
  findUnresolvableImports,
  isAllowedBareImport,
} from "../bundle-smoke.ts";
import {
  forbiddenTarballPath,
  requireEntry,
  verifyContents,
  verifyNativePlatformTarball,
  verifyPublicManifest,
} from "../verify-npm-tarballs.ts";

const version = "1.2.3";
const nativeFiles = [
  "nerve_native.linux-x64-gnu.node",
  "nerve_native.win32-arm64-msvc.node",
  "nerve_native.darwin-x64.node",
];
const nativePackages = nativeFiles.map(nativePlatformPackage);
const nativeNames = nativePackages.map((entry) => entry.name);

function publicManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "@nervekit/desktop",
    version,
    main: "dist/main.js",
    bin: { "nerve-desktop": "./dist/bin.js" },
    engines: { node: ">=24.0.0" },
    repository: { directory: "packages/desktop-shell" },
    optionalDependencies: nativeOptionalDependencies(nativePackages, version),
    dependencies: { electron: "^1", sharp: "^0.35.0" },
    ...overrides,
  };
}

test("a well-formed public manifest passes", () => {
  verifyPublicManifest(publicManifest(), version, "x.tgz", nativeNames);
});

test("public manifest violations are reported with the tarball name", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ main: "dist/other.js" }, /unexpected main/],
    [{ bin: {} }, /missing nerve-desktop bin/],
    [{ engines: { node: ">=20" } }, /Node engine/],
    [{ repository: { directory: "x" } }, /repository directory/],
    [{ bundleDependencies: ["@nervekit/contracts"] }, /bundleDependencies/],
    [
      {
        dependencies: {
          electron: "^1",
          sharp: "^0.35.0",
          "@nervekit/contracts": version,
        },
      },
      /exactly the external packages/,
    ],
    [{ dependencies: { electron: "^1" } }, /exactly the external packages/],
    [
      { optionalDependencies: { [nativeNames[0]!]: "0.0.1" } },
      /optionalDependencies must pin/,
    ],
    [
      {
        dependencies: {
          ...publicManifest().dependencies,
          [nativeNames[0]!]: version,
        },
      },
      /exactly the external packages/,
    ],
  ];
  for (const [override, message] of cases)
    assert.throws(
      () =>
        verifyPublicManifest(
          publicManifest(override),
          version,
          "x.tgz",
          nativeNames,
        ),
      message,
    );
});

test("tarball contents must be the bundle layout without maps or declarations", () => {
  const entries = [
    "package",
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/NOTICE",
    "package/THIRD-PARTY-LICENSES.txt",
    ...bundleOutputFiles.map((file) => `package/${file}`),
    "package/dist/web/assets/app.js",
    "package/dist/chunk-ABC.js",
    "package/dist/chunk-ABC.js.LEGAL.txt",
  ];
  verifyContents(entries, "x.tgz");
  const rejected: [string, RegExp][] = [
    ["package/dist/main.js.map", /forbidden/],
    ["package/dist/main.d.ts", /forbidden/],
    ["package/dist/x.tsbuildinfo", /forbidden/],
    ["package/node_modules/@nervekit/contracts/dist/index.js", /unexpected/],
    ["package/src/main.ts", /unexpected/],
  ];
  for (const [extra, message] of rejected)
    assert.throws(() => verifyContents([...entries, extra], "x.tgz"), message);
  assert.throws(
    () => verifyContents(entries.slice(0, -1), "x.tgz"),
    /legal comments/,
  );
  assert.throws(
    () =>
      verifyContents(
        entries.filter((entry) => entry !== "package/dist/daemon.js"),
        "x.tgz",
      ),
    /missing package\/dist\/daemon\.js/,
  );
  assert.equal(forbiddenTarballPath.test("package/dist/chunk-A.js"), false);
  assert.throws(() => requireEntry(["a"], "b", "x.tgz"), /missing b/);
  requireEntry(["a"], "a", "x.tgz");
});

test("bundle imports may only reference siblings and declared externals", () => {
  const source = [
    'import { a } from "./chunk-A.js";',
    'import "node:fs";',
    'import { b } from "electron";',
    'import sharp from "sharp";',
    'const m = await import("./worker.js");',
    'import "hono";',
    'import "./missing.js";',
  ].join("\n");
  assert.deepEqual(
    findUnresolvableImports(
      source,
      (specifier) => specifier !== "./missing.js",
    ),
    ["hono", "./missing.js"],
  );
  assert.equal(isAllowedBareImport("@nervekit/native-linux-x64-gnu"), true);
  assert.equal(isAllowedBareImport("@nervekit/contracts"), false);
  assert.equal(isAllowedBareImport("fs"), true);
});

test("third-party license inventory covers scoped and pnpm-nested packages only", () => {
  const input = (path: string) => [path, { bytes: 1, imports: [] }] as const;
  const roots = thirdPartyPackageRoots({
    inputs: Object.fromEntries([
      input("packages/contracts/dist/index.js"),
      input("node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core.js"),
      input("node_modules/.pnpm/zod@4.6.7/node_modules/zod/index.js"),
      input(
        "node_modules/.pnpm/@hono+node-server@2/node_modules/@hono/node-server/dist/index.js",
      ),
      input("node_modules/.pnpm/x/node_modules/@nervekit/native/dist/index.js"),
    ]),
    outputs: {},
  });
  assert.deepEqual(roots, [
    "node_modules/.pnpm/@hono+node-server@2/node_modules/@hono/node-server",
    "node_modules/.pnpm/zod@4.6.7/node_modules/zod",
  ]);
});

test("distribution dependencies keep only external packages and reject conflicting ranges", () => {
  const desktop = {
    dependencies: { "@nervekit/contracts": "workspace:*" },
    peerDependencies: { electron: "^41.0.0" },
  };
  const harness = {
    dependencies: { sharp: "^0.35.0", zod: "^4.0.0", yaml: "2.9.0" },
  };
  const dependencies = collectDistributionDependencies(desktop, [harness]);
  assert.deepEqual(dependencies, { electron: "^41.0.0", sharp: "^0.35.0" });
  assert.throws(
    () =>
      collectDistributionDependencies(desktop, [
        harness,
        { dependencies: { sharp: "^0.34.0" } },
      ]),
    /Conflicting runtime dependency ranges for sharp/,
  );
  assert.throws(
    () => collectDistributionDependencies(desktop, []),
    /external dependency sharp/,
  );
  assert.throws(
    () => collectDistributionDependencies({ dependencies: {} }, [harness]),
    /Electron peer dependency/,
  );
});

test("native platform packages carry exact os/cpu/libc and contents", () => {
  const [linux, windows] = nativePackages;
  assert.deepEqual(
    [linux!.os, linux!.cpu, linux!.libc, windows!.libc],
    ["linux", "x64", ["glibc"], undefined],
  );
  const manifest = (platform = linux!) =>
    nativePlatformManifest(
      platform,
      { engines: { node: ">=24.0.0" } },
      version,
    );
  const entries = (platform = linux!) => [
    "package",
    "package/package.json",
    "package/LICENSE",
    "package/NOTICE",
    `package/${platform.filename}`,
  ];
  verifyNativePlatformTarball(manifest(), entries(), linux!, version, "x.tgz");
  verifyNativePlatformTarball(
    manifest(windows),
    entries(windows),
    windows!,
    version,
    "x.tgz",
  );
  assert.deepEqual(manifest().os, ["linux"]);
  assert.throws(
    () =>
      verifyNativePlatformTarball(
        { ...manifest(), libc: undefined },
        entries(),
        linux!,
        version,
        "x.tgz",
      ),
    /libc/,
  );
  assert.throws(
    () =>
      verifyNativePlatformTarball(
        manifest(),
        [...entries(), "package/nerve_native.darwin-x64.node"],
        linux!,
        version,
        "x.tgz",
      ),
    /expected exactly/,
  );
  assert.throws(
    () =>
      verifyNativePlatformTarball(
        { ...manifest(), cpu: ["arm64"] },
        entries(),
        linux!,
        version,
        "x.tgz",
      ),
    /cpu/,
  );
});
