// Shared by create-extension.mjs and upgrade-extension.mjs. Plain Node, no dependencies.
//
// Maintainer note. The SDK version is Nerve's version, found in this order:
//   1. NERVE_EXTENSION_SDK_SPEC: an npm spec used verbatim (a `file:` folder, a tarball path or a
//      dist-tag). It replaces the registry version for `init` and for the project's dependency.
//      Dev slots set it to `file:<repo>/packages/extension-sdk` (the checkout's SDK, linked; its
//      dependencies resolve through the workspace). For a packed SDK whose dependencies
//      (@nervekit/extension-api, @nervekit/ui-kit) are not published, also set
//      NERVE_EXTENSION_NPM_OVERRIDES to a JSON object (package -> spec); it is written to the
//      project's package.json "overrides".
//   2. scripts/nerve-version.json ({ "version": "x.y.z" }), written next to this file when the
//      skill is copied into dist (scripts/build/copy-skills-assets.ts), so installed Nerve
//      builds and the desktop bundle carry the version they were built from.
//   3. The version of the Nerve source checkout containing this file (the root package.json).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SDK_PACKAGE = "@nervekit/extension-sdk";
export const MIN_NODE_MAJOR = 24;

export class UserError extends Error {}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The version of this Nerve, or throws a UserError that says how to proceed. */
export function nerveVersion(scriptDir) {
  const bundled = join(scriptDir, "nerve-version.json");
  if (existsSync(bundled)) {
    const { version } = JSON.parse(readFileSync(bundled, "utf8"));
    if (VERSION.test(version)) return version;
  }
  let dir = resolve(scriptDir);
  for (let depth = 0; depth < 10; depth += 1) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.name === "nerve" && VERSION.test(pkg.version ?? ""))
        return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new UserError(
    "Cannot tell which Nerve version this skill belongs to (scripts/nerve-version.json is missing). Reinstall Nerve, or set NERVE_EXTENSION_SDK_SPEC.",
  );
}

/** What to install and what the project depends on. */
export function resolveSdk(scriptDir, env = process.env) {
  const override = env.NERVE_EXTENSION_SDK_SPEC?.trim();
  if (override) {
    let overrides;
    if (env.NERVE_EXTENSION_NPM_OVERRIDES)
      overrides = JSON.parse(env.NERVE_EXTENSION_NPM_OVERRIDES);
    return {
      spec: override,
      dependency: override,
      overrides,
      version: undefined,
    };
  }
  const version = nerveVersion(scriptDir);
  return { spec: `${SDK_PACKAGE}@${version}`, dependency: version, version };
}

export function compareVersions(a, b) {
  const parts = (v) => v.split("-")[0].split(".").map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1)
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

/**
 * The sections of UPGRADING.md (`## X.Y.Z`) with `from < version <= to`, oldest first,
 * as one string; empty when none apply.
 */
export function upgradeNotes(markdown, from, to) {
  const sections = [];
  const heading = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/gm;
  const matches = [...markdown.matchAll(heading)];
  matches.forEach((match, index) => {
    const end = matches[index + 1]?.index ?? markdown.length;
    sections.push({
      version: match[1],
      text: markdown
        .slice(match.index, end)
        .replace(/\n<!--[\s\S]*$/, "")
        .trim(),
    });
  });
  return sections
    .filter(
      ({ version }) =>
        compareVersions(version, from) > 0 && compareVersions(version, to) <= 0,
    )
    .sort((x, y) => compareVersions(x.version, y.version))
    .map(({ text }) => text)
    .join("\n\n");
}

/** `--name value` flags and positional arguments. */
export function parseArgs(argv, valueFlags) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) positional.push(arg);
    else {
      const name = arg.slice(2);
      if (!valueFlags.includes(name))
        throw new UserError(`Unknown option --${name}.`);
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith("--"))
        throw new UserError(`--${name} needs a value.`);
      flags[name] = value;
    }
  }
  return { positional, flags };
}

/** Where the extension goes: an explicit --dir, else the user or project extensions folder. */
export function targetFolder({ id, scope, project, dir }, env = process.env) {
  if (dir) return resolve(dir);
  if (scope === "project")
    return join(resolve(project ?? process.cwd()), ".nerve", "extensions", id);
  const home = env.NERVE_HOME || join(homedir(), ".nerve");
  return join(resolve(home), "agent", "extensions", id);
}

/** Runs a command with inherited output; returns its exit code. */
export function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

function works(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

/** Checks Node and a package manager; throws a UserError with how to install what is missing. */
export function checkPrerequisites() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR)
    throw new UserError(
      `Node.js ${MIN_NODE_MAJOR} or newer is required; this is ${process.versions.node}. Install it from https://nodejs.org, or with a version manager (nvm install ${MIN_NODE_MAJOR}, fnm install ${MIN_NODE_MAJOR}), then run this script again.`,
    );
  if (works("npm")) return "npm";
  if (works("pnpm")) return "pnpm";
  throw new UserError(
    "Neither npm nor pnpm is installed. npm comes with Node.js (https://nodejs.org); pnpm: https://pnpm.io/installation. Install one, then run this script again.",
  );
}

/** Commands of the package manager: install, run `nerve-ext <args>`, and fetch-and-run the SDK. */
export function packageManager(name) {
  return name === "pnpm"
    ? {
        install: ["pnpm", ["install"]],
        ext: (args) => ["pnpm", ["exec", "nerve-ext", ...args]],
        dlx: (spec, args) => [
          "pnpm",
          ["dlx", `--package=${spec}`, "nerve-ext", ...args],
        ],
      }
    : {
        install: ["npm", ["install"]],
        ext: (args) => ["npx", ["--no-install", "nerve-ext", ...args]],
        dlx: (spec, args) => [
          "npx",
          ["--yes", `--package=${spec}`, "--", "nerve-ext", ...args],
        ],
      };
}

/** Prints a UserError as one line and exits 1; other errors keep their stack. */
export function main(fn) {
  Promise.resolve()
    .then(fn)
    .then((code) => process.exit(code ?? 0))
    .catch((error) => {
      if (error instanceof UserError) {
        console.error(`error: ${error.message}`);
        process.exit(1);
      }
      throw error;
    });
}
