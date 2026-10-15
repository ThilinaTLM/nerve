import assert from "node:assert/strict";
import test from "node:test";
import { classifyValidationImpact, isProse } from "../validation-impact.mjs";

const scopes = (impact) =>
  ["format", "lint", "packages", "native"].map((stage) => impact[stage].scope);
const manifest = (before, after) =>
  classifyValidationImpact(["package.json"], {
    rootManifest: { before, after },
  });
const pathScopes = (path) => scopes(classifyValidationImpact([path]));

test("root metadata, reordered objects, and ordinary scripts stay file-scoped", () => {
  for (const [before, after] of [
    [
      { version: "1", name: "old" },
      { name: "new", version: "2" },
    ],
    [
      { engines: { node: "24", pnpm: "11" } },
      { engines: { pnpm: "11", node: "24" } },
    ],
    [
      { scripts: { dev: "old", test: "old", release: "old" } },
      { scripts: { dev: "new", test: "new" } },
    ],
    [JSON.parse('{ "private": true }'), JSON.parse('{"private":true}')],
    [{ publishConfig: { access: "public" } }, { publishConfig: {} }],
  ])
    assert.deepEqual(scopes(manifest(before, after)), [
      "changed",
      "changed",
      "none",
      "none",
    ]);
});

test("validation/build scripts select only their governed stages on add/edit/remove", () => {
  const expected = {
    fix: ["all", "all", "none", "all"],
    "fix:focused": ["all", "all", "none", "all"],
    check: ["all", "all", "all", "all"],
    "check:focused": ["all", "all", "all", "all"],
    "migrations:check": ["changed", "changed", "none", "none"],
    build: ["changed", "changed", "all", "none"],
    "build:native": ["changed", "changed", "all", "all"],
    "build:workbench-runtime": ["changed", "changed", "all", "none"],
  };
  for (const [name, stages] of Object.entries(expected)) {
    for (const [before, after] of [
      [{}, { [name]: "new" }],
      [{ [name]: "old" }, { [name]: "new" }],
      [{ [name]: "old" }, {}],
    ]) {
      assert.deepEqual(
        scopes(manifest({ scripts: before }, { scripts: after })),
        stages,
        name,
      );
    }
  }
});

test("dependency groups compare names and versions, widening tool stages only", () => {
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, format, lint] of [
      ["tsx", "changed", "changed"],
      ["oxfmt", "all", "changed"],
      ["svelte", "all", "all"],
      ["eslint", "changed", "all"],
      ["@eslint/js", "changed", "all"],
      ["eslint-plugin-svelte", "changed", "all"],
      ["globals", "changed", "all"],
      ["typescript-eslint", "changed", "all"],
      ["typescript", "changed", "all"],
    ]) {
      for (const [before, after] of [
        [{}, { [name]: "2" }],
        [{ [name]: "1" }, { [name]: "2" }],
        [{ [name]: "1" }, {}],
      ]) {
        assert.deepEqual(
          scopes(manifest({ [group]: before }, { [group]: after })),
          [format, lint, "all", "none"],
          `${group}: ${name}`,
        );
      }
    }
  }
  assert.deepEqual(
    scopes(
      manifest(
        { dependencies: { eslint: "1", other: "1" } },
        { dependencies: { other: "2", eslint: "1" } },
      ),
    ),
    ["changed", "changed", "all", "none"],
  );
});

test("execution semantics and unknown manifest fields do not widen unrelated stages", () => {
  for (const field of ["workspaces", "engines", "futureField"]) {
    assert.deepEqual(scopes(manifest({}, { [field]: "new" })), [
      "changed",
      "changed",
      "all",
      "none",
    ]);
  }
  assert.deepEqual(scopes(manifest({}, { type: "module" })), [
    "changed",
    "all",
    "all",
    "none",
  ]);
  for (const field of ["packageManager", "pnpm", "overrides", "resolutions"]) {
    const impact = manifest({}, { [field]: "new" });
    assert.deepEqual(scopes(impact), ["all", "all", "all", "none"]);
    assert.match(impact.format.reasons[0], /resolution uncertainty/);
  }
});

test("missing semantic inputs broaden packages and invalid current objects error", () => {
  for (const rootManifest of [
    undefined,
    { before: null, after: {} },
    { before: {}, after: null },
  ]) {
    assert.deepEqual(
      scopes(classifyValidationImpact(["package.json"], { rootManifest })),
      ["changed", "changed", "all", "none"],
    );
  }
  assert.deepEqual(
    classifyValidationImpact(["package.json"], {
      rootManifest: { before: null, after: {}, reason: "Missing baseline" },
    }).packages.reasons,
    ["Missing baseline"],
  );
  assert.throws(() => manifest({}, []), /Invalid current root package.json/);
});

test("configuration impact is independent by stage", () => {
  for (const path of [
    ".oxfmtrc.json",
    ".oxfmtignore",
    ".prettierignore",
    ".prettierrc",
    "prettier.config.mjs",
    ".gitignore",
    ".editorconfig",
    "packages/example/.gitignore",
  ]) {
    assert.deepEqual(
      pathScopes(path),
      ["all", "changed", "none", "none"],
      path,
    );
  }
  for (const path of [
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintignore",
  ]) {
    assert.deepEqual(
      pathScopes(path),
      ["changed", "all", "none", "none"],
      path,
    );
  }
  assert.deepEqual(pathScopes("tsconfig.base.json"), [
    "changed",
    "all",
    "all",
    "none",
  ]);
  for (const path of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    const impact = classifyValidationImpact([path]);
    assert.deepEqual(scopes(impact), ["all", "all", "all", "none"]);
    assert.match(impact.lint.reasons[0], /resolution uncertainty/);
    assert.deepEqual(impact.packageInputs, []);
  }
  assert.deepEqual(pathScopes(".nvmrc"), ["changed", "changed", "all", "none"]);
});

test("known tooling and workflows stay narrow; unknown ownership widens packages only", () => {
  for (const path of [
    "scripts/checks/new.mjs",
    "scripts/testing/new.mjs",
    "scripts/shared/new.mjs",
    "scripts/storage-migrations/new.ts",
    ".github/workflows/check.yml",
  ]) {
    assert.deepEqual(
      pathScopes(path),
      ["changed", "changed", "none", "none"],
      path,
    );
  }
  const impact = classifyValidationImpact([
    "unknown.mjs",
    "scripts/unknown.mjs",
  ]);
  assert.deepEqual(scopes(impact), ["changed", "changed", "all", "none"]);
  assert.match(impact.packages.reasons[0], /Unknown package ownership/);
  assert.deepEqual(impact.packageInputs, []);
});

test("only ordinary package and special-owner paths enter package classification", () => {
  const paths = [
    "packages/example/src/code.ts",
    "packages/example/tsconfig.json",
    "packages/example/test/tsconfig.test.json",
    "scripts/build/copy-skills-assets.mjs",
    "assets/brand/icon.svg",
  ];
  const impact = classifyValidationImpact(
    [
      ...paths,
      ...paths,
      "README.md",
      "package.json",
      "eslint.config.js",
      "scripts/checks/new.mjs",
    ],
    { rootManifest: { before: {}, after: {} } },
  );
  assert.deepEqual(impact.packageInputs, paths.toSorted());
  assert.deepEqual(impact.lintPackageInputs, [
    "packages/example/test/tsconfig.test.json",
    "packages/example/tsconfig.json",
  ]);
  assert.equal(impact.packages.scope, "packages");
  assert.deepEqual(pathScopes("packages/example/tsconfig.json"), [
    "changed",
    "packages",
    "packages",
    "none",
  ]);
});

test("prose is ignored but runtime Markdown and website content retain owners", () => {
  const prose = [
    "README.md",
    "docs/example.md",
    "packages/example/README.md",
    "packages/example/src/AGENTS.md",
    "LICENSE",
    "NOTICE",
  ];
  const impact = classifyValidationImpact(prose);
  assert.equal(impact.nonProse, false);
  assert.deepEqual(impact.packageInputs, []);
  for (const path of prose) assert.equal(isProse(path), true);
  const runtime = [
    "packages/example/src/prompt.md",
    "packages/example/assets/prompt.md",
    "packages/example/test/fixture.md",
    "packages/website/README.md",
  ];
  assert.deepEqual(
    classifyValidationImpact(runtime).packageInputs,
    runtime.toSorted(),
  );
  assert.equal(classifyValidationImpact(runtime).nonProse, true);
});

test("Rust inputs select native work without npm resolution expansion", () => {
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "rust-toolchain",
    ".rustfmt.toml",
    ".cargo/config.toml",
  ]) {
    assert.deepEqual(
      pathScopes(path),
      ["changed", "changed", "none", "all"],
      path,
    );
  }
  for (const path of [
    "packages/native/native/src/lib.rs",
    "packages/native/native/Cargo.toml",
    "packages/native/native/Cargo.lock",
    "packages/native/native/.cargo/config.toml",
    "packages/native/native/rustfmt.toml",
  ]) {
    assert.deepEqual(
      pathScopes(path),
      ["changed", "changed", "packages", "all"],
      path,
    );
  }
  assert.deepEqual(pathScopes("packages/native/src/index.ts"), [
    "changed",
    "changed",
    "packages",
    "none",
  ]);
});

test("combined impacts widen independently and do not mutate inputs", () => {
  const paths = Object.freeze([
    "unknown.mjs",
    ".oxfmtrc.json",
    "packages/example/tsconfig.json",
  ]);
  const impact = classifyValidationImpact(paths);
  assert.deepEqual(scopes(impact), ["all", "packages", "all", "none"]);
  assert.deepEqual(impact.packageInputs, ["packages/example/tsconfig.json"]);
});
