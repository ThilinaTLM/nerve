import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  nativePlatformPackage,
  nativeTarballFilename,
  verifyNativePrebuilds,
  type NativePlatformPackage,
} from "./native-prebuilds.ts";
import {
  assertWorkspaceVersionsMatch,
  bundledPackages as internalPackages,
  readJson,
} from "./workspace-packages.ts";
import { repoRoot } from "../workspace/repo.ts";
import {
  collectDistributionDependencies,
  nativeOptionalDependencies,
  nativePlatformManifest,
} from "./npm-manifests.ts";
import {
  bundleAssets,
  bundleDesktop,
  bundleEntryPoints,
} from "./bundle-desktop.ts";
import { verifyNpmTarballs } from "./verify-npm-tarballs.ts";

const releaseRoot = join(repoRoot, "release");
const packDir = join(releaseRoot, "npm");
const stageRoot = join(releaseRoot, "npm-stage", "desktop");

try {
  await verifyBuildOutputs();
  await rm(packDir, { recursive: true, force: true });
  await rm(join(releaseRoot, "npm-stage"), { recursive: true, force: true });
  await mkdir(packDir, { recursive: true });
  const platformPackages = await stageNativePlatformPackages();
  await stageDesktopDistribution(platformPackages);

  const rootVersion = (await readJson("package.json")).version;
  for (const platformPackage of platformPackages) {
    console.log(`Packing ${platformPackage.name}...`);
    run(
      "npm",
      ["pack", "--pack-destination", packDir],
      nativeStageRoot(platformPackage),
    );
  }
  console.log("Packing @nervekit/desktop...");
  run("npm", ["pack", "--pack-destination", packDir], stageRoot);

  const expectedFilename = `nervekit-desktop-${rootVersion}.tgz`;
  const expectedFilenames = [
    expectedFilename,
    ...platformPackages.map((platformPackage) =>
      nativeTarballFilename(platformPackage, rootVersion),
    ),
  ].sort();
  const packed = (await readdir(packDir))
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  if (JSON.stringify(packed) !== JSON.stringify(expectedFilenames)) {
    throw new Error(
      `Expected exactly ${expectedFilenames.join(", ")}, but found ${packed.join(", ") || "no tarballs"}.`,
    );
  }

  for (const name of packed) console.log(`Packed ${join(packDir, name)}.`);
  await verifyNpmTarballs(packDir);
} finally {
  await rm(join(releaseRoot, "npm-stage"), {
    recursive: true,
    force: true,
  });
}

async function verifyBuildOutputs() {
  const required = [
    ...Object.values(bundleEntryPoints),
    ...bundleAssets.map(([source]) => source),
    "packages/workbench-app/dist/index.html",
  ];
  for (const relativePath of required) {
    await access(join(repoRoot, relativePath)).catch(() => {
      throw new Error(
        `Missing ${relativePath}. Run pnpm build before packing the desktop package.`,
      );
    });
  }
}

function nativeStageRoot(platformPackage: NativePlatformPackage) {
  return join(releaseRoot, "npm-stage", `native-${platformPackage.triple}`);
}

/** Stages one `@nervekit/native-<triple>` package per prebuilt binary. */
async function stageNativePlatformPackages() {
  await assertWorkspaceVersionsMatch();
  const prebuilds = join(repoRoot, "packages", "native", "prebuilds");
  const filenames = await verifyNativePrebuilds(prebuilds);
  const platformPackages = filenames.map(nativePlatformPackage);
  const rootManifest = await readJson("package.json");
  const nativeManifest = await readJson(
    join("packages", "native", "package.json"),
  );
  for (const platformPackage of platformPackages) {
    const root = nativeStageRoot(platformPackage);
    await mkdir(root, { recursive: true });
    await cp(
      join(prebuilds, platformPackage.filename),
      join(root, platformPackage.filename),
    );
    for (const filename of ["LICENSE", "NOTICE"]) {
      await cp(join(repoRoot, filename), join(root, filename));
    }
    await writeJson(
      join(root, "package.json"),
      nativePlatformManifest(
        platformPackage,
        nativeManifest,
        rootManifest.version,
      ),
    );
  }
  return platformPackages;
}

async function stageDesktopDistribution(
  platformPackages: NativePlatformPackage[],
) {
  const rootManifest = await readJson("package.json");
  const desktopManifest = await readJson(
    join("packages", "desktop-shell", "package.json"),
  );
  const internalManifests = new Map();
  for (const [name, directory] of internalPackages) {
    const manifest = await readJson(
      join("packages", directory, "package.json"),
    );
    if (manifest.name !== name)
      throw new Error(
        `packages/${directory}/package.json is ${manifest.name}, expected ${name}.`,
      );
    internalManifests.set(name, manifest);
  }

  await mkdir(stageRoot, { recursive: true });
  await bundleDesktop({ repoRoot, stageRoot });
  for (const filename of ["LICENSE", "NOTICE", "README.md"]) {
    await cp(join(repoRoot, filename), join(stageRoot, filename));
  }
  await chmod(join(stageRoot, "dist", "bin.js"), 0o755);

  const dependencies = collectDistributionDependencies(
    desktopManifest,
    internalManifests.values(),
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
      "README.md",
      "THIRD-PARTY-LICENSES.txt",
      "LICENSE",
      "NOTICE",
    ],
    dependencies,
    optionalDependencies: nativeOptionalDependencies(
      platformPackages,
      rootManifest.version,
    ),
    engines: desktopManifest.engines,
  };
  await writeJson(join(stageRoot, "package.json"), publicManifest);
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command: string, args: string[], cwd: string) {
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
