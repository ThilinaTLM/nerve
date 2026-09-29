#!/usr/bin/env node
import { resolve } from "node:path";
import { updateStorageReadCompatibility } from "../lib/storage-read-compatibility.mjs";

const repoRoot = process.env.NERVE_REPO_ROOT ?? process.cwd();
const path = updateStorageReadCompatibility(resolve(repoRoot));
console.log(`Updated storage reader compatibility: ${path}`);
