#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicPackage = ["@nervekit/desktop", "desktop"];
const bundledPackages = [
  ["@nervekit/contracts", "contracts"],
  ["@nervekit/protocol", "protocol"],
  ["@nervekit/harness", "harness"],
  ["@nervekit/tools", "tools"],
  ["@nervekit/host-runtime", "host-runtime"],
  ["@nervekit/workbench-server", "workbench-server"],
];

export async function verifyNpmTarballs(
  packDirectory = join(repoRoot, "release", "npm"),
) {
  const rootVersion = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ).version;
  const expectedFilename = `nervekit-desktop-${rootVersion}.tgz`;
  const tarball = join(packDirectory, expectedFilename);
  const manifest = extractJson(tarball, "package/package.json");
  if (manifest.name !== publicPackage[0] || manifest.version !== rootVersion)
    throw new Error(
      `${expectedFilename}: expected ${publicPackage[0]}@${rootVersion}, found ${manifest.name}@${manifest.version}.`,
    );
  if (manifest.private === true)
    throw new Error(
      `${expectedFilename}: public manifest must not be private.`,
    );
  if (JSON.stringify(manifest).includes("workspace:"))
    throw new Error(
      `${expectedFilename}: public manifest contains a workspace dependency.`,
    );

  const entries = tarEntries(tarball);
  verifyPublicManifest(manifest, rootVersion, expectedFilename);
  verifyContents(tarball, entries, rootVersion, expectedFilename);
  verifyDesktopBin(tarball, expectedFilename);
  await isolatedInstallSmoke(tarball, rootVersion);
  console.log(
    `Verified ${publicPackage[0]}@${rootVersion} tarball and isolated bundled runtime resolution.`,
  );
}

function verifyPublicManifest(manifest, version, filename) {
  if (manifest.main !== "dist/main.js")
    throw new Error(`${filename}: unexpected main entry ${manifest.main}.`);
  if (manifest.bin?.["nerve-desktop"] !== "./dist/bin.js")
    throw new Error(`${filename}: missing nerve-desktop bin entry.`);
  if (manifest.engines?.node !== ">=24.0.0")
    throw new Error(`${filename}: unexpected Node engine.`);
  if (manifest.repository?.directory !== "packages/desktop-shell")
    throw new Error(`${filename}: unexpected repository directory.`);

  const expectedBundled = bundledPackages.map(([name]) => name);
  if (
    JSON.stringify(manifest.bundleDependencies) !==
    JSON.stringify(expectedBundled)
  )
    throw new Error(
      `${filename}: bundleDependencies must contain exactly ${expectedBundled.join(", ")}.`,
    );
  for (const name of expectedBundled) {
    if (manifest.dependencies?.[name] !== version)
      throw new Error(
        `${filename}: expected exact bundled dependency ${name}@${version}.`,
      );
  }
  for (const name of ["electron", "sharp"]) {
    if (!manifest.dependencies?.[name])
      throw new Error(`${filename}: missing external dependency ${name}.`);
    if (manifest.bundleDependencies.includes(name))
      throw new Error(`${filename}: ${name} must not be bundled.`);
  }
}

function verifyContents(tarball, entries, version, filename) {
  const requiredRoot = [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/NOTICE",
    "package/dist/bin.js",
    "package/dist/main.js",
    "package/dist/preload.cjs",
    "package/build/README.md",
  ];
  for (const entry of requiredRoot) requireEntry(entries, entry, filename);

  const allowedInternalRoots = new Set(
    bundledPackages.map(
      ([name]) =>
        `package/node_modules/@nervekit/${name.slice("@nervekit/".length)}`,
    ),
  );
  for (const entry of entries) {
    if (
      entry === "package" ||
      entry === "package/package.json" ||
      entry === "package/README.md" ||
      entry === "package/LICENSE" ||
      entry === "package/NOTICE" ||
      entry === "package/dist" ||
      entry.startsWith("package/dist/") ||
      entry === "package/build" ||
      entry.startsWith("package/build/") ||
      entry === "package/node_modules" ||
      entry === "package/node_modules/@nervekit"
    )
      continue;
    const internalRoot = [...allowedInternalRoots].find(
      (root) => entry === root || entry.startsWith(`${root}/`),
    );
    if (!internalRoot)
      throw new Error(`${filename}: unexpected packed path ${entry}.`);
    const relative = entry.slice(internalRoot.length).replace(/^\//, "");
    if (
      relative === "" ||
      relative === "package.json" ||
      relative === "LICENSE" ||
      relative === "NOTICE" ||
      relative === "dist" ||
      relative.startsWith("dist/") ||
      (internalRoot.endsWith("/contracts") &&
        (relative === "schemas" || relative.startsWith("schemas/")))
    )
      continue;
    throw new Error(`${filename}: unexpected bundled package path ${entry}.`);
  }

  const forbidden =
    /(?:^|\/)(?:src|test|tests|\.nerve|\.git|release|coverage|cache)(?:\/|$)|\.(?:log|sqlite|db|node)$/i;
  for (const entry of entries) {
    if (forbidden.test(entry))
      throw new Error(`${filename}: forbidden packed path ${entry}.`);
  }

  for (const [packageName, directory] of bundledPackages) {
    const packageRoot = `package/node_modules/@nervekit/${directory}`;
    for (const entry of [
      `${packageRoot}/package.json`,
      `${packageRoot}/LICENSE`,
      `${packageRoot}/NOTICE`,
      `${packageRoot}/dist/index.js`,
      `${packageRoot}/dist/index.d.ts`,
    ])
      requireEntry(entries, entry, filename);
    const manifest = extractJson(tarball, `${packageRoot}/package.json`);
    if (manifest.name !== packageName || manifest.version !== version)
      throw new Error(
        `${filename}: expected bundled ${packageName}@${version}, found ${manifest.name}@${manifest.version}.`,
      );
    if (manifest.private !== undefined || manifest.publishConfig !== undefined)
      throw new Error(
        `${filename}: bundled ${packageName} contains publication metadata.`,
      );
    if (JSON.stringify(manifest).includes("workspace:"))
      throw new Error(
        `${filename}: bundled ${packageName} contains a workspace dependency.`,
      );
    for (const target of exportTargets(manifest.exports)) {
      requireEntry(
        entries,
        `${packageRoot}/${target.replace(/^\.\//, "")}`,
        filename,
      );
    }
  }

  requireEntry(
    entries,
    "package/node_modules/@nervekit/contracts/schemas/sandbox-config-v1.schema.json",
    filename,
  );
  requireEntry(
    entries,
    "package/node_modules/@nervekit/workbench-server/dist/main.js",
    filename,
  );
  requireEntry(
    entries,
    "package/node_modules/@nervekit/workbench-server/dist/web/index.html",
    filename,
  );
  if (
    !entries.some((entry) =>
      entry.startsWith(
        "package/node_modules/@nervekit/workbench-server/dist/web/assets/",
      ),
    )
  )
    throw new Error(`${filename}: bundled workbench web assets are missing.`);
}

function exportTargets(exportsField) {
  const targets = [];
  const visit = (value) => {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) visit(child);
  };
  visit(exportsField);
  return targets;
}

function verifyDesktopBin(tarball, filename) {
  const source = capture("tar", ["-xOzf", tarball, "package/dist/bin.js"]);
  if (!source.startsWith("#!/usr/bin/env node"))
    throw new Error(`${filename}: desktop bin is missing its Node shebang.`);
  const verbose = capture("tar", ["-tvzf", tarball]);
  const line = verbose
    .split(/\r?\n/)
    .find((entry) => entry.trim().endsWith("package/dist/bin.js"));
  if (!line || !/^-rwx/.test(line.trim()))
    throw new Error(`${filename}: desktop bin is not executable.`);
}

async function isolatedInstallSmoke(tarball, version) {
  const directory = await mkdtemp(join(os.tmpdir(), "nerve-npm-smoke-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "nerve-release-smoke", version: "1.0.0", private: true, type: "module" }, null, 2)}\n`,
    );
    run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      directory,
    );

    const lock = JSON.parse(
      await readFile(join(directory, "package-lock.json"), "utf8"),
    );
    if (JSON.stringify(lock).includes("workspace:"))
      throw new Error("isolated package-lock contains workspace references.");
    verifyBundledLockEntries(lock, version);

    const desktopRoot = join(directory, "node_modules", "@nervekit", "desktop");
    const desktopSmoke = join(desktopRoot, "dist", "npm-bundle-smoke.mjs");
    await writeFile(
      desktopSmoke,
      `
const packages = ${JSON.stringify(bundledPackages.map(([name]) => name))};
for (const name of packages) {
  console.log(name, import.meta.resolve(name));
  await import(name);
}
for (const subpath of [
  "@nervekit/contracts/schemas/sandbox-config-v1.schema.json",
  "@nervekit/harness/node",
  "@nervekit/harness/worker",
  "@nervekit/host-runtime/harness",
  "@nervekit/host-runtime/harness/worker",
  "@nervekit/host-runtime/tools",
  "@nervekit/host-runtime/test-support",
  "@nervekit/workbench-server/main"
]) console.log(subpath, import.meta.resolve(subpath));
`,
    );
    run(process.execPath, [desktopSmoke], directory);

    const serverSmoke = join(
      desktopRoot,
      "node_modules",
      "@nervekit",
      "workbench-server",
      "dist",
      "npm-worker-smoke.mjs",
    );
    await writeFile(
      serverSmoke,
      `console.log(import.meta.resolve("@nervekit/host-runtime/harness/worker"));\n`,
    );
    run(process.execPath, [serverSmoke], directory);

    const bin = join(desktopRoot, "dist", "bin.js");
    const versionOutput = capture(
      process.execPath,
      [bin, "--version"],
      directory,
    ).trim();
    if (versionOutput !== `@nervekit/desktop ${version}`)
      throw new Error(
        `desktop --version returned ${JSON.stringify(versionOutput)}.`,
      );
    const helpOutput = capture(process.execPath, [bin, "--help"], directory);
    if (
      !helpOutput.includes("Usage:") ||
      !helpOutput.includes("npx @nervekit/desktop") ||
      !helpOutput.includes("--connect <url>")
    )
      throw new Error("desktop --help output is incomplete.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function verifyBundledLockEntries(lock, version) {
  const packages = lock.packages ?? {};
  for (const [name] of bundledPackages) {
    const suffix = `/node_modules/${name}`;
    const entries = Object.entries(packages).filter(
      ([path, metadata]) =>
        (path === `node_modules/${name}` || path.endsWith(suffix)) &&
        metadata?.version === version,
    );
    if (entries.length !== 1)
      throw new Error(
        `isolated package-lock expected one bundled ${name}@${version}, found ${entries.length}.`,
      );
    const [path, metadata] = entries[0];
    if (
      typeof metadata.resolved === "string" &&
      isNpmRegistryUrl(metadata.resolved)
    )
      throw new Error(`${path} was resolved from the npm registry.`);
  }
}

function isNpmRegistryUrl(value) {
  try {
    return new URL(value).hostname === "registry.npmjs.org";
  } catch {
    return false;
  }
}

function requireEntry(entries, entry, filename) {
  if (!entries.includes(entry))
    throw new Error(`${filename}: missing ${entry}.`);
}

function extractJson(tarball, entry) {
  return JSON.parse(capture("tar", ["-xOzf", tarball, entry]));
}

function tarEntries(tarball) {
  return capture("tar", ["-tzf", tarball])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ""));
}

function capture(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return result.stdout;
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyNpmTarballs(
    process.argv[2] ? resolve(process.argv[2]) : undefined,
  );
}
