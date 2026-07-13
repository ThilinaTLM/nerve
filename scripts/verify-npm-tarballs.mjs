#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const publicPackages = [
  ["@nervekit/contracts", "contracts"],
  ["@nervekit/protocol", "protocol"],
  ["@nervekit/harness", "harness"],
  ["@nervekit/tools", "tools"],
  ["@nervekit/host-runtime", "host-runtime"],
  ["@nervekit/workbench-server", "workbench-server"],
  ["@nervekit/desktop-shell", "desktop-shell"],
];

export async function verifyNpmTarballs(
  packDirectory = join(repoRoot, "release", "npm"),
) {
  const rootVersion = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ).version;
  const tarballs = [];
  for (const [packageName, directory] of publicPackages) {
    const expectedFilename = `nervekit-${directory}-${rootVersion}.tgz`;
    const tarball = join(packDirectory, expectedFilename);
    const manifest = JSON.parse(
      capture("tar", ["-xOzf", tarball, "package/package.json"]),
    );
    if (manifest.name !== packageName || manifest.version !== rootVersion)
      throw new Error(
        `${expectedFilename}: expected ${packageName}@${rootVersion}, found ${manifest.name}@${manifest.version}`,
      );
    if (JSON.stringify(manifest).includes("workspace:"))
      throw new Error(
        `${expectedFilename}: packed manifest contains workspace: dependency`,
      );

    const entries = capture("tar", ["-tzf", tarball])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((entry) => entry.replace(/\/$/, ""));
    verifyContents(directory, entries, manifest, expectedFilename);
    if (directory === "desktop-shell")
      verifyDesktopBin(tarball, expectedFilename);
    tarballs.push(tarball);
  }

  await isolatedInstallSmoke(tarballs, rootVersion);
  console.log(
    `Verified ${tarballs.length} npm tarballs and isolated runtime resolution.`,
  );
}

function verifyContents(directory, entries, manifest, filename) {
  const required = [
    "package/package.json",
    "package/LICENSE",
    "package/NOTICE",
  ];
  for (const entry of required) {
    if (!entries.includes(entry))
      throw new Error(`${filename}: missing ${entry}`);
  }
  for (const entry of ["package/dist/index.js", "package/dist/index.d.ts"]) {
    if (!entries.includes(entry) && directory !== "desktop-shell")
      throw new Error(`${filename}: missing ${entry}`);
  }
  const allowedRoots = new Set([
    "package/package.json",
    "package/LICENSE",
    "package/NOTICE",
  ]);
  for (const entry of entries) {
    if (entry === "package" || allowedRoots.has(entry)) continue;
    if (entry === "package/dist" || entry.startsWith("package/dist/")) continue;
    if (
      directory === "contracts" &&
      (entry === "package/schemas" || entry.startsWith("package/schemas/"))
    )
      continue;
    if (
      directory === "desktop-shell" &&
      (entry === "package/build" || entry.startsWith("package/build/"))
    )
      continue;
    throw new Error(`${filename}: unexpected packed path ${entry}`);
  }
  const forbidden =
    /^package\/(?:src|test|tests|\.nerve|\.git|node_modules|release|coverage|logs?|cache)(?:\/|$)|\/node_modules\/|\.(?:log|sqlite|db)$/i;
  for (const entry of entries) {
    if (forbidden.test(entry))
      throw new Error(`${filename}: forbidden packed path ${entry}`);
  }
  for (const target of exportTargets(manifest.exports)) {
    const path = `package/${target.replace(/^\.\//, "")}`;
    if (!entries.includes(path))
      throw new Error(`${filename}: export target is missing: ${path}`);
  }
  if (
    directory === "contracts" &&
    !entries.includes("package/schemas/sandbox-config-v1.schema.json")
  )
    throw new Error(`${filename}: sandbox config JSON schema is missing`);
  if (directory === "workbench-server") {
    if (!entries.includes("package/dist/web/index.html"))
      throw new Error(`${filename}: bundled web index is missing`);
    if (!entries.some((entry) => entry.startsWith("package/dist/web/assets/")))
      throw new Error(`${filename}: bundled web assets are missing`);
  }
  if (directory === "desktop-shell") {
    for (const entry of [
      "package/dist/bin.js",
      "package/dist/main.js",
      "package/dist/preload.cjs",
      "package/build/README.md",
    ]) {
      if (!entries.includes(entry))
        throw new Error(
          `${filename}: desktop runtime file is missing: ${entry}`,
        );
    }
  }
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
    throw new Error(`${filename}: desktop bin is missing its Node shebang`);
  const verbose = capture("tar", ["-tvzf", tarball]);
  const line = verbose
    .split(/\r?\n/)
    .find((entry) => entry.trim().endsWith("package/dist/bin.js"));
  if (!line || !/^-rwx/.test(line.trim()))
    throw new Error(
      `${filename}: desktop bin is not executable in the tarball`,
    );
}

async function isolatedInstallSmoke(tarballs, version) {
  const directory = await mkdtemp(join(os.tmpdir(), "nerve-npm-smoke-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "nerve-release-smoke", version: "1.0.0", private: true, type: "module" }, null, 2)}\n`,
    );
    run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs],
      directory,
    );
    const lock = await readFile(join(directory, "package-lock.json"), "utf8");
    if (lock.includes("workspace:"))
      throw new Error("isolated package-lock contains workspace: references");
    const smoke = `
const packages = ${JSON.stringify(publicPackages.map(([name]) => name))};
for (const name of packages) console.log(name, import.meta.resolve(name));
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
for (const name of packages.filter((name) => name !== "@nervekit/desktop-shell")) await import(name);
`;
    await writeFile(join(directory, "smoke.mjs"), smoke);
    run(process.execPath, ["smoke.mjs"], directory);
    const bin = join(
      directory,
      "node_modules",
      "@nervekit",
      "desktop-shell",
      "dist",
      "bin.js",
    );
    const versionOutput = capture(
      process.execPath,
      [bin, "--version"],
      directory,
    ).trim();
    if (versionOutput !== `@nervekit/desktop-shell ${version}`)
      throw new Error(
        `desktop --version returned ${JSON.stringify(versionOutput)}`,
      );
    const helpOutput = capture(process.execPath, [bin, "--help"], directory);
    if (
      !helpOutput.includes("Usage:") ||
      !helpOutput.includes("--connect <url>")
    )
      throw new Error("desktop --help output is incomplete");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
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
