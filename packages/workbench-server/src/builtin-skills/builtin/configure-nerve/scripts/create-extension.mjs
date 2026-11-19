#!/usr/bin/env node
// Scaffolds a Nerve extension, installs its dependencies and runs `nerve-ext check`.
//   node create-extension.mjs <id> --kind <kind>[,<kind>...]   (preview, page, panel, theme, integration)
//        [--scope user|project] [--project <dir>] [--dir <path>]
// Plain Node, no dependencies. The SDK version is this Nerve's (see lib.mjs).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  SDK_PACKAGE,
  UserError,
  checkPrerequisites,
  main,
  packageManager,
  parseArgs,
  resolveSdk,
  run,
  targetFolder,
} from "./lib.mjs";

const KINDS = ["preview", "page", "panel", "theme", "integration"];
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function distIgnored(folder) {
  const result = spawnSync(
    "git",
    ["check-ignore", "-q", join(folder, "dist", "manifest.json")],
    { cwd: folder, stdio: "ignore" },
  );
  return result.status === 0;
}

/** NERVE_EXTENSION_SDK_SPEC (maintainers): install the spec with its overrides into a temp folder, run its `nerve-ext`. */
function initFromLocalSdk(pm, sdk, initArgs) {
  const tools = mkdtempSync(join(tmpdir(), "nerve-ext-tools-"));
  try {
    writeFileSync(
      join(tools, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: { [SDK_PACKAGE]: sdk.dependency },
        overrides: sdk.overrides,
      }),
    );
    if (run(pm.install[0], pm.install[1], tools) !== 0) return 1;
    return run(
      process.execPath,
      [
        join(tools, "node_modules", SDK_PACKAGE, "bin", "nerve-ext.js"),
        ...initArgs,
      ],
      tools,
    );
  } finally {
    rmSync(tools, { recursive: true, force: true });
  }
}

function patchDependency(folder, sdk) {
  const file = join(folder, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.dependencies[SDK_PACKAGE] = sdk.dependency;
  if (sdk.overrides) pkg.overrides = sdk.overrides;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

main(() => {
  const { positional, flags } = parseArgs(process.argv.slice(2), [
    "kind",
    "scope",
    "project",
    "dir",
  ]);
  const [id] = positional;
  if (!id || !ID.test(id) || id.length > 64)
    throw new UserError(
      "Pass an extension id: lowercase letters, digits and single hyphens, starting with a letter (csv-viewer).",
    );
  const kinds = (flags.kind ?? "").split(",").map((kind) => kind.trim());
  if (!kinds.every((kind) => KINDS.includes(kind)))
    throw new UserError(
      `--kind must be one or more of: ${KINDS.join(", ")} (comma-separated, such as integration,panel).`,
    );
  const scope = flags.scope ?? "user";
  if (scope !== "user" && scope !== "project")
    throw new UserError("--scope must be user or project.");
  const folder = targetFolder({
    id,
    scope,
    project: flags.project,
    dir: flags.dir,
  });
  if (existsSync(folder))
    throw new UserError(
      `${folder} already exists. Edit that extension in place, or choose another id.`,
    );

  const manager = checkPrerequisites();
  const pm = packageManager(manager);
  const sdk = resolveSdk(dirname(fileURLToPath(import.meta.url)));

  console.log(
    `Creating ${id} (${kinds.join(", ")}, ${scope}) in ${folder} with ${sdk.spec}`,
  );
  mkdirSync(dirname(folder), { recursive: true });
  const initArgs = ["init", id, "--kind", kinds.join(","), "--dir", folder];
  const initialized = sdk.version
    ? run(...pm.dlx(sdk.spec, initArgs), dirname(folder))
    : initFromLocalSdk(pm, sdk, initArgs);
  if (initialized !== 0)
    throw new UserError(
      `Could not run ${sdk.spec}. Check the network connection and that this version is published on npm.`,
    );
  patchDependency(folder, sdk);
  if (run(pm.install[0], pm.install[1], folder) !== 0)
    throw new UserError(
      `${manager} install failed in ${folder}; see the output above.`,
    );
  const [checkCmd, checkArgs] = pm.ext(["check"]);
  const code = run(checkCmd, checkArgs, folder);
  if (code !== 0) {
    console.error(
      `The scaffold is in ${folder} but nerve-ext check failed; fix it there and rerun \`nerve-ext check\`.`,
    );
    return code;
  }
  if (scope === "project" && distIgnored(folder))
    console.warn(
      `warning: git ignores ${join(folder, "dist")}. Commit dist/ so teammates get a loadable extension: add "!.nerve/extensions/*/dist/" to the project's .gitignore.`,
    );
  console.log(
    `\nReady: ${folder}\nNext: implement it, run \`nerve-ext check\`, reload it with extensions.reload("${id}") and read extensions.status("${id}").`,
  );
  return 0;
});
