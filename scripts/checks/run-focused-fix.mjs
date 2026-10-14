#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./focused-validation-runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await main("fix", root);
