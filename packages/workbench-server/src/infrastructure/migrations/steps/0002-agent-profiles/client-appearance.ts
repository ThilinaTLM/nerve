import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StepContext } from "../../framework/step.js";
import { json, safePath, writeJson } from "./files.js";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Remove only the daemon's retired client preferences. */
export function convertClientAppearance(value: unknown): unknown {
  const result = structuredClone(value);
  if (object(result) && object(result.appearance)) {
    delete result.appearance.theme;
    delete result.appearance.colorMode;
  }
  return result;
}

export function upgradeClientAppearance(
  ctx: StepContext,
  verifyOnly = false,
): void {
  const path = join(ctx.paths.home, "config", "ui.json");
  safePath(path);
  if (!existsSync(path)) return;
  let before: unknown;
  try {
    before = json(path);
  } catch {
    // Settings Health owns malformed configuration; leave its bytes intact.
    return;
  }
  const after = convertClientAppearance(before);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  assert(!verifyOnly, `Client appearance was not upgraded: ${path}`);
  ctx.ownPaths([path], ctx.paths.home);
  writeJson(ctx, path, after);
}
