import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { StepContext } from "../../framework/step.js";
import {
  convertProfilesDocument,
  profilesDocument,
  profileConversionReceipt,
} from "./profile-format.js";

export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function safePath(path: string): void {
  for (let entry = resolve(path); ; entry = dirname(entry)) {
    const stat = lstatSync(entry, { throwIfNoEntry: false });
    assert(!stat?.isSymbolicLink(), `Symlinked migration path: ${entry}`);
    if (entry === dirname(entry)) break;
  }
}
export function json(path: string): unknown {
  safePath(path);
  assert(lstatSync(path).isFile(), `Expected regular file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}
export function writeJson(
  ctx: StepContext,
  path: string,
  document: unknown,
): void {
  safePath(path);
  ctx.fs.write(path, JSON.stringify(document, null, 2) + "\n");
}

/** Step 0001 already converted Markdown; this step consumes only its JSON output.
 * Retain a source digest/target receipt before replacement for crash-safe retries.
 */
export function convertProfiles(ctx: StepContext, root: string): void {
  const source = join(root, "config", "subagents.json");
  const target = join(root, "config", "agent-profiles.json");
  safePath(source);
  safePath(target);
  const receiptPath = join(
    ctx.scratchDir,
    `profiles-${digest(resolve(root))}.json`,
  );
  const receipt = existsSync(receiptPath)
    ? profileConversionReceipt.parse(json(receiptPath))
    : undefined;
  if (!existsSync(source)) {
    if (existsSync(target)) {
      const current = profilesDocument.parse(json(target));
      if (receipt)
        assert.deepEqual(
          current,
          receipt.document,
          `Changed profile migration target: ${target}`,
        );
    }
    return;
  }
  const document = convertProfilesDocument(json(source));
  const sourceDigest = digest(readFileSync(source, "utf8"));
  if (receipt) {
    assert.equal(
      receipt.sources[source],
      sourceDigest,
      `Profile source changed during migration: ${source}`,
    );
    assert.deepEqual(
      receipt.document,
      document,
      `Changed profile conversion: ${source}`,
    );
  }
  if (existsSync(target))
    assert.deepEqual(
      profilesDocument.parse(json(target)),
      document,
      `Agent profile collision: ${target}`,
    );
  writeJson(ctx, receiptPath, {
    document,
    sources: { [source]: sourceDigest },
  });
  writeJson(ctx, target, document);
  assert.deepEqual(profilesDocument.parse(json(target)), document);
  assert.equal(
    digest(readFileSync(source, "utf8")),
    sourceDigest,
    `Profile source changed during conversion: ${source}`,
  );
  ctx.fs.remove(source);
}
