import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyNpmTarballs } from "./verify-npm-tarballs.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repoRoot, "release");
const packDir = join(releaseRoot, "npm");
const stageRoot = join(releaseRoot, "npm-stage", "desktop");
const desktopRoot = join(repoRoot, "packages", "desktop-shell");
const internalPackages = [
  ["@nervekit/contracts", "contracts"],
  ["@nervekit/protocol", "protocol"],
  ["@nervekit/harness", "harness"],
  ["@nervekit/tools", "tools"],
  ["@nervekit/host-runtime", "host-runtime"],
  ["@nervekit/workbench-server", "workbench-server"],
];
const internalNames = new Set(internalPackages.map(([name]) => name));

try {
  await verifyBuildOutputs();
  await rm(packDir, { recursive: true, force: true });
  await rm(join(releaseRoot, "npm-stage"), { recursive: true, force: true });
  await mkdir(packDir, { recursive: true });
  await stageDesktopDistribution();

  console.log("Packing @nervekit/desktop...");
  run("npm", ["pack", "--pack-destination", packDir], stageRoot);

  const rootVersion = (await readJson(join(repoRoot, "package.json"))).version;
  const expectedFilename = `nervekit-desktop-${rootVersion}.tgz`;
  const packed = (await readdir(packDir))
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  if (JSON.stringify(packed) !== JSON.stringify([expectedFilename])) {
    throw new Error(
      `Expected only ${expectedFilename}, but found ${packed.join(", ") || "no tarballs"}.`,
    );
  }

  console.log(`Packed ${join(packDir, expectedFilename)}.`);
  await verifyNpmTarballs(packDir);
} finally {
  await rm(join(releaseRoot, "npm-stage"), {
    recursive: true,
    force: true,
  });
}

async function verifyBuildOutputs() {
  const required = [
    [
      join("packages", "desktop-shell", "dist", "bin.js"),
      "Run pnpm release:build before packing the desktop package.",
    ],
    [
      join("packages", "desktop-shell", "dist", "main.js"),
      "Run pnpm release:build before packing the desktop package.",
    ],
    [
      join("packages", "desktop-shell", "dist", "preload.cjs"),
      "Run pnpm release:build before packing the desktop package.",
    ],
    [
      join("packages", "workbench-server", "dist", "main.js"),
      "Run pnpm release:build before packing the desktop package.",
    ],
    [
      join("packages", "workbench-server", "dist", "web", "index.html"),
      "Run pnpm release:build so workbench-server contains the built web app.",
    ],
    [
      join("packages", "workbench-app", "dist", "index.html"),
      "Run pnpm release:build before packing the desktop package.",
    ],
  ];
  for (const [relativePath, message] of required) {
    await access(join(repoRoot, relativePath)).catch(() => {
      throw new Error(`Missing ${relativePath}. ${message}`);
    });
  }
  for (const [, directory] of internalPackages) {
    await access(join(repoRoot, "packages", directory, "dist")).catch(() => {
      throw new Error(
        `Missing packages/${directory}/dist. Run pnpm release:build before packing the desktop package.`,
      );
    });
  }
}

async function stageDesktopDistribution() {
  const rootManifest = await readJson(join(repoRoot, "package.json"));
  const desktopManifest = await readJson(join(desktopRoot, "package.json"));
  const internalManifests = new Map();
  for (const [name, directory] of internalPackages) {
    const manifest = await readJson(
      join(repoRoot, "packages", directory, "package.json"),
    );
    if (manifest.name !== name)
      throw new Error(
        `packages/${directory}/package.json is ${manifest.name}, expected ${name}.`,
      );
    if (manifest.version !== rootManifest.version)
      throw new Error(
        `${name}@${manifest.version} does not match root ${rootManifest.version}.`,
      );
    internalManifests.set(name, manifest);
  }

  await mkdir(stageRoot, { recursive: true });
  await cp(join(desktopRoot, "dist"), join(stageRoot, "dist"), {
    recursive: true,
  });
  await cp(join(desktopRoot, "build"), join(stageRoot, "build"), {
    recursive: true,
  });
  for (const filename of ["LICENSE", "NOTICE", "README.md"]) {
    await cp(join(repoRoot, filename), join(stageRoot, filename));
  }
  await chmod(join(stageRoot, "dist", "bin.js"), 0o755);

  const dependencies = collectDistributionDependencies(
    desktopManifest,
    internalManifests,
    rootManifest.version,
  );
  const publicManifest = {
    name: "@nervekit/desktop",
    version: rootManifest.version,
    description: "UI-first personal AI coding harness desktop application.",
    author: desktopManifest.author,
    license: desktopManifest.license,
    type: desktopManifest.type,
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org",
    },
    repository: desktopManifest.repository,
    homepage: desktopManifest.homepage,
    desktopName: desktopManifest.desktopName,
    main: desktopManifest.main,
    bin: desktopManifest.bin,
    files: [
      "dist/**",
      "build/**",
      "node_modules/@nervekit/**",
      "README.md",
      "LICENSE",
      "NOTICE",
    ],
    dependencies,
    bundleDependencies: internalPackages.map(([name]) => name),
    engines: desktopManifest.engines,
  };
  await writeJson(join(stageRoot, "package.json"), publicManifest);

  for (const [name, directory] of internalPackages) {
    const sourceRoot = join(repoRoot, "packages", directory);
    const destinationRoot = join(
      stageRoot,
      "node_modules",
      "@nervekit",
      name.slice("@nervekit/".length),
    );
    await mkdir(destinationRoot, { recursive: true });
    await cp(join(sourceRoot, "dist"), join(destinationRoot, "dist"), {
      recursive: true,
    });
    if (directory === "contracts") {
      await cp(join(sourceRoot, "schemas"), join(destinationRoot, "schemas"), {
        recursive: true,
      });
    }
    for (const filename of ["LICENSE", "NOTICE"]) {
      await cp(join(repoRoot, filename), join(destinationRoot, filename));
    }
    await writeJson(
      join(destinationRoot, "package.json"),
      embeddedManifest(internalManifests.get(name), rootManifest.version),
    );
  }
}

function collectDistributionDependencies(
  desktopManifest,
  internalManifests,
  version,
) {
  const external = new Map();
  const addDependencies = (manifest) => {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (internalNames.has(name)) continue;
      const existing = external.get(name);
      if (existing && existing !== range)
        throw new Error(
          `Conflicting runtime dependency ranges for ${name}: ${existing} and ${range}.`,
        );
      external.set(name, range);
    }
  };
  addDependencies(desktopManifest);
  for (const manifest of internalManifests.values()) addDependencies(manifest);

  const electronRange = desktopManifest.peerDependencies?.electron;
  if (!electronRange)
    throw new Error("desktop-shell must declare its Electron peer dependency.");
  external.set("electron", electronRange);

  return Object.fromEntries(
    [
      ...internalPackages.map(([name]) => [name, version]),
      ...[...external.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function embeddedManifest(manifest, version) {
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, range]) => [
      name,
      internalNames.has(name) ? version : range,
    ]),
  );
  return Object.fromEntries(
    Object.entries({
      name: manifest.name,
      version,
      description: manifest.description,
      author: manifest.author,
      license: manifest.license,
      type: manifest.type,
      main: manifest.main,
      exports: manifest.exports,
      dependencies,
      engines: manifest.engines,
    }).filter(([, value]) => value !== undefined),
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd} with exit code ${result.status}.`,
    );
}
