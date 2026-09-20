/**
 * Privacy gate for captured screenshots.
 *
 * Publishing a frame that leaks a token, an internal hostname, or a private
 * project name cannot be undone, so the text snapshot written beside every
 * capture is scanned before any asset is optimized into `src/assets`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Project and repository names the demo seed is allowed to show. */
const ALLOWED_NAMES = [/^aurora(-[a-z]+)?$/, /^nerve$/];

const RULES = [
  {
    id: "credential",
    pattern:
      /\b(sk-[A-Za-z0-9-]{8,}|nt_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{8,})/,
    message: "looks like a credential or token",
  },
  {
    id: "email",
    /* demo@aurora.example is the seeded author and is deliberately allowed. */
    pattern: /\b[\w.+-]+@(?!aurora\.example\b)[\w-]+\.[\w.]{2,}\b/,
    message: "contains an email address",
  },
  {
    id: "private-ip",
    pattern:
      /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
    message: "contains a private IP address",
  },
  {
    id: "home-path",
    pattern: /\/home\/(?!runner\b)[a-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+/,
    message: "contains a real home directory path",
  },
];

/** Paths outside the throwaway capture directories are always suspect. */
const ALLOWED_PATH_PREFIXES = [
  "/tmp/nerve-demo-home",
  "/tmp/nerve-demo-workspace",
];

export function findViolations(text) {
  const violations = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) violations.push(`${rule.id}: ${rule.message} (${match[0]})`);
  }
  /* Only genuinely absolute paths: the lookbehind keeps relative references
   * such as `src/middleware/rate-limit.ts` from matching at the slash. */
  for (const match of text.matchAll(/(?<![\w.-])(?:\/[A-Za-z0-9._-]+){2,}/g)) {
    const path = match[0];
    if (!path.startsWith("/")) continue;
    if (ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)))
      continue;
    if (path.startsWith("/tmp/")) continue;
    if (/^\/(?:bookings|venues|api|docs|guides|start|models)\b/.test(path))
      continue;
    if (/^\/(?:src|test|deploy|app|components|lib|packages)\//.test(path))
      continue;
    violations.push(`path: unexpected absolute path (${path})`);
    break;
  }
  return violations;
}

export function isAllowedProjectName(name) {
  return ALLOWED_NAMES.some((pattern) => pattern.test(name));
}

async function main() {
  const root = process.argv[2] ?? ".screenshots";
  const failures = [];
  for (const kind of ["desktop", "mobile"]) {
    const files = await readdir(join(root, kind)).catch(() => []);
    if (files.length === 0) continue;
    for (const file of files.filter((name) => name.endsWith(".txt"))) {
      const text = await readFile(join(root, kind, file), "utf8");
      for (const violation of findViolations(text)) {
        failures.push(`${kind}/${file}: ${violation}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error("Screenshot privacy check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Screenshot privacy check passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
