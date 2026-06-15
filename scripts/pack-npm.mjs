import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readdir, rm, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(repoRoot, "release", "npm");
const legalFiles = ["LICENSE", "NOTICE"];
const publishPackages = [
  ["@nerve/shared", join("packages", "shared")],
  ["@nerve/tools", join("packages", "tools")],
  ["@nerve/agent", join("packages", "agent")],
  ["@nerve/orchestrator", join("packages", "orchestrator")],
  ["@nerve/cli", join("packages", "cli")],
];

const createdLegalFiles = [];

try {
  await access(
    join(repoRoot, "packages", "orchestrator", "dist", "web", "index.html"),
  ).catch(() => {
    throw new Error(
      "Missing packages/orchestrator/dist/web/index.html. Run pnpm release:build before packing npm packages.",
    );
  });

  await rm(packDir, { recursive: true, force: true });
  await mkdir(packDir, { recursive: true });
  await stageLegalFiles();

  for (const [name, relativeDir] of publishPackages) {
    const cwd = join(repoRoot, relativeDir);
    console.log(`Packing ${name}...`);
    run("pnpm", ["pack", "--pack-destination", packDir], cwd);
  }

  const packed = (await readdir(packDir))
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  console.log(`Packed ${packed.length} npm tarballs into ${packDir}:`);
  for (const filename of packed) console.log(`  ${filename}`);
} finally {
  await Promise.all(
    createdLegalFiles.map((path) => unlink(path).catch(() => undefined)),
  );
}

async function stageLegalFiles() {
  for (const [, relativeDir] of publishPackages) {
    const packageDir = join(repoRoot, relativeDir);
    for (const filename of legalFiles) {
      const destination = join(packageDir, filename);
      if (await exists(destination)) continue;
      await copyFile(join(repoRoot, filename), destination);
      createdLegalFiles.push(destination);
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd} with exit code ${result.status}`,
    );
  }
}
