import { join } from "node:path";
import {
  legacyScopeFailure,
  LegacyScopeError,
  type ReleasedScopeInput,
} from "./released-scope.js";
import type { ExportIO } from "./released-export.js";
import {
  splitCatalogV037,
  merge,
  type ConversionContext,
  type Data,
  type convertPreferencesV037,
} from "./released-format.js";
import { exportedTarget, type ExportTarget } from "./released-export.js";

export function isolateScopeTargets(
  root: string,
  input: ReleasedScopeInput,
  io: Pick<ExportIO, "read">,
  targets: Record<string, ExportTarget>,
): Record<string, ExportTarget> {
  try {
    for (const path of Object.keys(targets))
      if (!input.snapshots.has(path) && io.read(path) !== undefined)
        throw new Error(
          `Existing conversion target requires manual reconciliation: ${path}`,
        );
    return targets;
  } catch (cause) {
    const error = legacyScopeFailure(cause, root, io);
    if (!(error instanceof LegacyScopeError)) throw error;
    input.issues.push(...error.issues);
    return {};
  }
}

export function releasedScopeTargets(
  root: string,
  scope: "user" | "project",
  before: Data,
  context: ConversionContext,
  result: ReturnType<typeof convertPreferencesV037>,
): Record<string, ExportTarget> {
  const targets: Record<string, ExportTarget> = {};
  if (before.subagents) {
    const split = splitCatalogV037(before.subagents, scope, context);
    if (Object.keys(split.launches).length)
      result.agent.overrides = merge(result.agent.overrides, {
        subagents: split.launches,
      });
    for (const [name, profile] of Object.entries(split.profiles))
      targets[
        join(
          root,
          scope === "project" ? "agent-profiles" : "data/agent-profiles",
          name + ".json",
        )
      ] = exportedTarget("profile", profile);
  }
  if (Object.keys(result.agent.overrides).length)
    targets[join(root, "config/agent.json")] = exportedTarget(
      "preferences",
      result.agent,
    );
  if (Object.keys(result.creation.overrides).length)
    targets[join(root, "config/conversation-defaults.json")] = exportedTarget(
      "creation",
      result.creation,
    );
  if (result.integrations)
    targets[join(root, "config/integrations.json")] = exportedTarget(
      "integrations",
      result.integrations,
    );
  return targets;
}
