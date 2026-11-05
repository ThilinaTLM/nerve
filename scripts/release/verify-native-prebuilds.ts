#!/usr/bin/env node
import { resolve } from "node:path";
import { verifyNativePrebuilds } from "./native-prebuilds.ts";
import { repoRoot } from "../workspace/repo.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const directory = resolve(repoRoot, args[0] ?? "packages/native/prebuilds");
const filenames = await verifyNativePrebuilds(directory);
console.log(`Verified ${filenames.length} native prebuilds in ${directory}.`);
