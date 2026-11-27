#!/usr/bin/env node
// Installs the dependencies of an extension folder (one you did not scaffold in this conversation,
// such as a received or shared one) and builds it with `nerve-ext check`.
//   node install-extension.mjs <extension-folder> --list   print the dependencies besides the SDK and stop
//   node install-extension.mjs <extension-folder>          print them, install, build
// Install scripts never run; a lockfile in the folder is used as it is (npm ci, pnpm --frozen-lockfile).
// Plain Node, no dependencies.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  UserError,
  checkPrerequisites,
  main,
  packageManager,
  parseArgs,
  printForeignDependencies,
  run,
} from "./lib.mjs";

main(() => {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes("--list");
  const { positional } = parseArgs(
    argv.filter((arg) => arg !== "--list"),
    [],
  );
  const folder = resolve(positional[0] ?? ".");
  if (!existsSync(join(folder, "package.json")))
    throw new UserError(
      `${folder} has no package.json; pass the extension folder.`,
    );
  printForeignDependencies(folder);
  if (listOnly) {
    console.log(
      "Nothing was installed. Show this list to the user and wait for their go-ahead, then run the script without --list.",
    );
    return 0;
  }
  const manager = checkPrerequisites();
  const pm = packageManager(manager);
  if (run(...pm.install(folder), folder) !== 0)
    throw new UserError(
      `${manager} install failed in ${folder}; see the output above.`,
    );
  const [cmd, args] = pm.ext(["check"]);
  return run(cmd, args, folder);
});
