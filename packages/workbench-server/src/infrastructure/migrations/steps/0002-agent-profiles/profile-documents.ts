import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StepContext } from "../../framework/step.js";
import { json, safePath, writeJson } from "./files.js";

type Data = Record<string, unknown>;
const object = (value: unknown): value is Data =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only profile-owned fields: ordinary settings retain their source defaults. */
export function convertProfileDocument(value: unknown): unknown {
  const result = structuredClone(value);
  assert(object(result), "Expected a profile document");
  if (Object.hasOwn(result, "description")) {
    assert(
      !Object.hasOwn(result, "whenToUse") ||
        result.whenToUse === result.description,
      "Conflicting profile when-to-use fields",
    );
    result.whenToUse = result.description;
    delete result.description;
  }
  dropProfileDefaults(result);
  return result;
}
function dropProfileDefaults(profile: Data): void {
  for (const section of ["recommendations", "requirements"]) {
    const contribution = structuredClone(profile[section]);
    if (!object(contribution) || !object(contribution.skills)) continue;
    profile[section] = contribution;
    delete contribution.skills.defaults;
    if (!Object.keys(contribution.skills).length) delete contribution.skills;
  }
}
export function convertAppliedProfileDocument(value: unknown): unknown {
  const result = structuredClone(value);
  if (object(result) && object(result.appliedProfile))
    dropProfileDefaults(result.appliedProfile);
  return result;
}
export function isAppliedHome(ctx: StepContext): boolean {
  const manifest = json(ctx.paths.manifestPath) as Data;
  return (
    Array.isArray(manifest.migrations) &&
    manifest.migrations.some(
      (entry: unknown) => object(entry) && entry.id === "0002-agent-profiles",
    )
  );
}

/** Applied draft homes must not replay legacy SQL/export receipts. Journal just
 * the current authored documents; trust remains bound to the original bytes. */
export function upgradeProfileDocuments(
  ctx: StepContext,
  verifyOnly = false,
): void {
  const roots = new Map([
    [ctx.paths.home, join(ctx.paths.home, "data", "agent-profiles")],
  ]);
  safePath(ctx.paths.sqlitePath);
  if (existsSync(ctx.paths.sqlitePath)) {
    const db = new DatabaseSync(ctx.paths.sqlitePath, { readOnly: true });
    try {
      for (const row of db
        .prepare("SELECT directory FROM project ORDER BY id")
        .all())
        roots.set(
          join(String(row.directory), ".nerve"),
          join(String(row.directory), ".nerve", "agent-profiles"),
        );
    } finally {
      db.close();
    }
  }
  function update(
    path: string,
    root: string,
    convert: (value: unknown) => unknown,
  ) {
    safePath(path);
    if (!existsSync(path)) return;
    const before = json(path),
      after = convert(before);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    assert(!verifyOnly, `Profile document was not upgraded: ${path}`);
    ctx.ownPaths([path], root);
    writeJson(ctx, path, after);
  }
  for (const [root, directory] of roots) {
    safePath(directory);
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory).sort())
      if (file.endsWith(".json"))
        update(join(directory, file), root, convertProfileDocument);
  }
  const conversations = join(ctx.paths.home, "data", "conversations");
  safePath(conversations);
  if (existsSync(conversations))
    for (const id of readdirSync(conversations).sort())
      update(
        join(conversations, id, "config", "agent.json"),
        ctx.paths.home,
        convertAppliedProfileDocument,
      );
}
