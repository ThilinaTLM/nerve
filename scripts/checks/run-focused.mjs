#!/usr/bin/env node
// Entry point for `pnpm fix:focused` and `pnpm check:focused`: run-focused.mjs <fix|check> [flags].
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./focused-validation-runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [operation, ...args] = process.argv.slice(2);
await main(operation, root, { args });
