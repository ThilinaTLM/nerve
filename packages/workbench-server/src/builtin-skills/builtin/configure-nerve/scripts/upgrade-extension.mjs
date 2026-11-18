#!/usr/bin/env node
// Upgrades an extension project to this Nerve's SDK version, prints what UPGRADING.md says
// between the old and new versions, then runs `nerve-ext check`.
//   node upgrade-extension.mjs <extension-folder>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SDK_PACKAGE,
  UserError,
  checkPrerequisites,
  compareVersions,
  main,
  packageManager,
  parseArgs,
  resolveSdk,
  run,
  upgradeNotes,
} from "./lib.mjs";

main(() => {
  const { positional } = parseArgs(process.argv.slice(2), []);
  const folder = resolve(positional[0] ?? ".");
  const file = join(folder, "package.json");
  if (!existsSync(file))
    throw new UserError(
      `${folder} has no package.json; pass the extension folder.`,
    );
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const current = pkg.dependencies?.[SDK_PACKAGE];
  if (!current)
    throw new UserError(
      `${file} does not depend on ${SDK_PACKAGE}; this is not an SDK-built extension.`,
    );
  const sdk = resolveSdk(dirname(fileURLToPath(import.meta.url)));
  const from = current.replace(/^[\^~]/, "");
  const manager = checkPrerequisites();
  const pm = packageManager(manager);

  if (sdk.version && compareVersions(from, sdk.version) === 0)
    console.log(`Already on SDK ${from}.`);
  else {
    pkg.dependencies[SDK_PACKAGE] = sdk.dependency;
    if (sdk.overrides) pkg.overrides = sdk.overrides;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`SDK ${from} -> ${sdk.dependency}`);
    if (run(pm.install[0], pm.install[1], folder) !== 0)
      throw new UserError(
        `${manager} install failed in ${folder}; see the output above.`,
      );
    const notes = join(folder, "node_modules", SDK_PACKAGE, "UPGRADING.md");
    if (sdk.version && existsSync(notes)) {
      const text = upgradeNotes(readFileSync(notes, "utf8"), from, sdk.version);
      console.log(
        text
          ? `\nApply these changes (oldest first), then rerun check:\n\n${text}\n`
          : "\nNo breaking changes between these versions.\n",
      );
    }
  }
  const [cmd, args] = pm.ext(["check"]);
  return run(cmd, args, folder);
});
