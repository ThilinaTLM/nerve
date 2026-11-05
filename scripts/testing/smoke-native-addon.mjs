#!/usr/bin/env node
// Loads the built native addon so a stale, truncated or wrong-platform
// artifact fails the consuming CI job immediately instead of deep in a test.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(repoRoot, "packages/native/prebuilds/local");
const addon = readdirSync(directory).find((name) => name.endsWith(".node"));
if (!addon) throw new Error(`No native addon (*.node) in ${directory}`);
const binding = createRequire(import.meta.url)(join(directory, addon));
const exportCount = Object.keys(binding).length;
if (exportCount === 0) throw new Error(`${addon} loaded with no exports`);
console.log(`Native addon ${addon} loaded (${exportCount} exports)`);
