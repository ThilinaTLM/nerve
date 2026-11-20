import { watch } from "node:fs";
import { resolve } from "node:path";
import { buildExtension, sdkVersion } from "./build.js";
import { extensionKinds, initExtension, type ExtensionKind } from "./init.js";
import {
  ExtensionProjectError,
  formatProblem,
  type Problem,
} from "./problems.js";
import { runTests, typecheck } from "./tools.js";

const usage = `nerve-ext: build tooling for Nerve extensions

Usage:
  nerve-ext init <id> --kind <kind>[,<kind>...] [--dir <path>] [--install] [--quiet]
                    kinds: ${extensionKinds.join(", ")}; several combine into one project
  nerve-ext build   Bundle src/extension.ts into dist/ (backend.js, manifest.json, docs, icon)
  nerve-ext check   Type check, build and validate, run tests; one command for the agent
  nerve-ext test    Run the tests with Vitest
  nerve-ext dev     Rebuild dist/ when the sources change

Run build, check, test and dev in the extension folder (the one holding package.json).`;

function usageError(what: string, fix: string): ExtensionProjectError {
  return new ExtensionProjectError({ what, where: "command line", fix });
}

function parseArguments(args: string[]): {
  positional: string[];
  flags: Map<string, string | true>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string?];
    if (name === "install" || name === "quiet") flags.set(name, true);
    else if (inline !== undefined) flags.set(name, inline);
    else {
      const value = args[++index];
      if (value === undefined || value.startsWith("--"))
        throw usageError(`--${name} needs a value.`, `Pass --${name} <value>.`);
      flags.set(name, value);
    }
  }
  return { positional, flags };
}

async function build(projectDir: string): Promise<void> {
  const { manifest } = await buildExtension({ projectDir });
  console.log(
    `Built ${manifest.id} ${manifest.version} (SDK ${manifest.sdkVersion}) into ${resolve(projectDir, "dist")}`,
  );
}

async function check(projectDir: string): Promise<number> {
  let failed = false;
  console.log("[1/3] Type check (tsc --noEmit)");
  if ((await typecheck(projectDir)) !== 0) {
    failed = true;
    console.error(
      "error: the TypeScript check failed\n  where: the diagnostics above\n  fix: Fix each reported file and line, then run nerve-ext check again.",
    );
  }
  console.log("[2/3] Build and validate");
  try {
    await build(projectDir);
  } catch (cause) {
    if (!(cause instanceof ExtensionProjectError)) throw cause;
    failed = true;
    console.error(cause.message);
  }
  console.log("[3/3] Tests (vitest run)");
  if ((await runTests(projectDir)) !== 0) {
    failed = true;
    console.error(
      "error: tests failed\n  where: the Vitest output above\n  fix: Fix the failing tests or the code they cover, then run nerve-ext check again.",
    );
  }
  console.log(failed ? "check failed" : "check passed");
  return failed ? 1 : 0;
}

async function dev(projectDir: string): Promise<number> {
  const rebuild = async () => {
    try {
      await build(projectDir);
    } catch (cause) {
      if (!(cause instanceof ExtensionProjectError)) throw cause;
      console.error(cause.message);
    }
  };
  await rebuild();
  let timer: NodeJS.Timeout | undefined;
  for (const path of ["src", "docs", "package.json", "icon.svg"]) {
    try {
      watch(resolve(projectDir, path), { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void rebuild(), 150);
      });
    } catch {
      // The folder or file does not exist (docs/, icon.svg are optional).
    }
  }
  console.log("Watching src/, docs/ and package.json. Press Ctrl+C to stop.");
  await new Promise(() => undefined);
  return 0;
}

/** Runs the CLI; returns the exit code. */
export async function main(
  args: string[],
  cwd = process.cwd(),
): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (
      !command ||
      command === "--help" ||
      command === "-h" ||
      command === "help"
    ) {
      console.log(usage);
      return command ? 0 : 1;
    }
    if (command === "--version" || command === "-v") {
      console.log(await sdkVersion());
      return 0;
    }
    const { positional, flags } = parseArguments(rest);
    switch (command) {
      case "init": {
        const id = positional[0];
        const kind = flags.get("kind");
        if (!id)
          throw usageError(
            "init needs an extension id.",
            "Run `nerve-ext init <id> --kind integration`.",
          );
        if (typeof kind !== "string")
          throw usageError(
            "init needs --kind.",
            `Pass --kind with one or more of: ${extensionKinds.join(", ")} (comma-separated).`,
          );
        const dir = flags.get("dir");
        const folder = await initExtension({
          id,
          kind: kind
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean) as ExtensionKind[],
          cwd,
          ...(typeof dir === "string" ? { dir } : {}),
        });
        console.log(`Created ${folder}`);
        if (flags.get("install") === true) {
          const code = await new Promise<number>((done) => {
            void import("node:child_process").then(({ spawn }) =>
              spawn("npm", ["install"], {
                cwd: folder,
                stdio: "inherit",
                shell: process.platform === "win32",
              }).on("close", (exit) => done(exit ?? 1)),
            );
          });
          if (code !== 0) return code;
        } else if (flags.get("quiet") !== true)
          console.log(
            `Next: cd ${folder} && npm install && npx nerve-ext check`,
          );
        return 0;
      }
      case "build":
        await build(cwd);
        return 0;
      case "check":
        return await check(cwd);
      case "test":
        return await runTests(cwd);
      case "dev":
        return await dev(cwd);
      default:
        throw usageError(
          `Unknown command '${command}'.`,
          "Use one of: init, build, check, test, dev (nerve-ext --help).",
        );
    }
  } catch (cause) {
    if (cause instanceof ExtensionProjectError) {
      console.error(cause.message);
      return 1;
    }
    const problem: Problem = {
      what: cause instanceof Error ? cause.message : String(cause),
      where: "nerve-ext internal error",
      fix: "Report this with the command you ran.",
    };
    console.error(formatProblem(problem));
    return 1;
  }
}
