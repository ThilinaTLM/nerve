#!/usr/bin/env node
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { deriveConversationTitle } from "../packages/contracts/dist/index.js";
import {
  compareDataset,
  prepareDataset,
  reportDataset,
} from "./lib/conversation-title-eval.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_OUTPUT = resolve("dogfood-output", "conversation-title-eval");

function usage() {
  return `Build contracts first:
  pnpm --filter @nervekit/contracts build

Usage:
  node scripts/conversation-title-eval.mjs prepare [--home PATH] [--output PATH] [--force]
  node scripts/conversation-title-eval.mjs compare [--dataset PATH]
  node scripts/conversation-title-eval.mjs report [--dataset PATH] [--review PATH]`;
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!["prepare", "compare", "report"].includes(command)) {
    throw new Error(usage());
  }
  const options = { command, force: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if (!["--home", "--output", "--dataset", "--review"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[argument.slice(2)] = resolve(value);
    index += 1;
  }
  return options;
}

async function gitRevision() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(import.meta.dirname, ".."),
    });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const dataset = options.dataset ?? options.output ?? DEFAULT_OUTPUT;
  if (options.command === "prepare") {
    const home =
      options.home ??
      resolve(process.env.NERVE_HOME ?? resolve(homedir(), ".nerve"));
    console.warn(
      "Warning: this dataset contains raw user prompts and may contain secrets. Keep it local and gitignored.",
    );
    const manifest = await prepareDataset({
      home,
      output: dataset,
      generateTitle: deriveConversationTitle,
      revision: await gitRevision(),
      force: options.force,
    });
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (options.command === "compare") {
    console.warn(
      "Warning: comparison artifacts contain raw user prompts. Keep them local and gitignored.",
    );
    console.log(
      JSON.stringify(
        await compareDataset({
          dataset,
          generateTitle: deriveConversationTitle,
        }),
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    JSON.stringify(
      await reportDataset({ dataset, reviewPath: options.review }),
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
