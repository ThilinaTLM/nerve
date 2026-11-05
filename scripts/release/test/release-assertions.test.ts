import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDistributionDependencies,
  embeddedManifest,
} from "../npm-manifests.ts";
import {
  isNpmRegistryUrl,
  requireEntry,
  verifyBundledLockEntries,
  verifyPublicManifest,
} from "../verify-npm-tarballs.ts";
import { bundledPackages } from "../workspace-packages.ts";

const version = "1.2.3";
const names = bundledPackages.map(([name]) => name);

function publicManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "@nervekit/desktop",
    version,
    main: "dist/main.js",
    bin: { "nerve-desktop": "./dist/bin.js" },
    engines: { node: ">=24.0.0" },
    repository: { directory: "packages/desktop-shell" },
    bundleDependencies: names,
    dependencies: {
      ...Object.fromEntries(names.map((name) => [name, version])),
      electron: "^1",
      sharp: "^0.35.0",
    },
    ...overrides,
  };
}

test("a well-formed public manifest passes", () => {
  verifyPublicManifest(publicManifest(), version, "x.tgz");
});

test("public manifest violations are reported with the tarball name", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ main: "dist/other.js" }, /unexpected main/],
    [{ bin: {} }, /missing nerve-desktop bin/],
    [{ engines: { node: ">=20" } }, /Node engine/],
    [{ repository: { directory: "x" } }, /repository directory/],
    [{ bundleDependencies: names.slice(1) }, /bundleDependencies must contain/],
    [
      {
        dependencies: {
          ...publicManifest().dependencies,
          [names[0]!]: "0.0.1",
        },
      },
      /exact bundled dependency/,
    ],
    [
      { bundleDependencies: [...names, "electron"] },
      /bundleDependencies must contain/,
    ],
  ];
  for (const [override, message] of cases)
    assert.throws(
      () => verifyPublicManifest(publicManifest(override), version, "x.tgz"),
      message,
    );
});

test("bundled lock entries must be local, unique and at the release version", () => {
  const entry = (name: string, resolved?: string) => ({
    [`node_modules/${name}`]: { version, ...(resolved ? { resolved } : {}) },
  });
  const lock = {
    packages: Object.assign({}, ...names.map((name) => entry(name))),
  };
  verifyBundledLockEntries(lock, version);
  assert.throws(
    () => verifyBundledLockEntries({ packages: {} }, version),
    /expected one bundled/,
  );
  assert.throws(
    () =>
      verifyBundledLockEntries(
        {
          packages: {
            ...lock.packages,
            ...entry(names[0]!, "https://registry.npmjs.org/x/-/x-1.tgz"),
          },
        },
        version,
      ),
    /npm registry/,
  );
  assert.equal(isNpmRegistryUrl("https://registry.npmjs.org/a"), true);
  assert.equal(isNpmRegistryUrl("file:../a.tgz"), false);
  assert.throws(() => requireEntry(["a"], "b", "x.tgz"), /missing b/);
  requireEntry(["a"], "a", "x.tgz");
});

test("distribution dependencies pin bundled packages and reject conflicting external ranges", () => {
  const internal = new Map(
    names.map((name) => [
      name,
      { name, dependencies: { zod: "^4.0.0", [names[0]!]: "workspace:*" } },
    ]),
  );
  const desktop = {
    dependencies: { zod: "^4.0.0", sharp: "^0.35.0" },
    peerDependencies: { electron: "^41.0.0" },
  };
  const dependencies = collectDistributionDependencies(
    desktop,
    internal,
    version,
  );
  assert.equal(dependencies[names[0]!], version);
  assert.equal(dependencies.electron, "^41.0.0");
  assert.equal(dependencies.zod, "^4.0.0");
  assert.deepEqual(Object.keys(dependencies), Object.keys(dependencies).sort());

  assert.throws(
    () =>
      collectDistributionDependencies(
        { ...desktop, dependencies: { zod: "^3.0.0" } },
        internal,
        version,
      ),
    /Conflicting runtime dependency ranges for zod/,
  );
  assert.throws(
    () =>
      collectDistributionDependencies({ dependencies: {} }, internal, version),
    /Electron peer dependency/,
  );
});

test("embedded manifests pin internal dependencies and drop undefined fields", () => {
  const manifest = embeddedManifest(
    {
      name: names[1],
      version: "0.0.0",
      dependencies: { [names[0]!]: "workspace:*", zod: "^4.0.0" },
    },
    version,
  );
  assert.deepEqual(manifest, {
    name: names[1],
    version,
    dependencies: { [names[0]!]: version, zod: "^4.0.0" },
  });
});
