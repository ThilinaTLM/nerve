import baseline from "./released-baseline.json" with { type: "json" };
import { join } from "node:path";
import { z } from "zod";
import { type LegacyConfigurationFile } from "@nervekit/contracts/agent-configuration";
import {
  convertPreferencesV037,
  convertCapabilitiesV037,
  releasedConversationHarnessSchema,
  releasedCatalogSchema,
  splitCatalogV037,
  sha256,
  type ConversionContext,
  type Data,
} from "./released-format.js";
import type { ExportIO } from "./released-export.js";

const releasedFiles = [
  "harness",
  "capabilities",
  "subagents",
  "integrations",
] as const;
type ReleasedScope = "user" | "project" | "conversation";

export const releasedBuiltins = Object.fromEntries(
  baseline.builtins.map((profile) => [profile.name, profile]),
);

export interface LegacyScopeIssue {
  file: LegacyConfigurationFile;
  path: string;
  reason: string;
  digest?: string;
}
export class LegacyScopeError extends Error {
  constructor(readonly issues: readonly LegacyScopeIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.reason}`).join("; "));
  }
}
export interface ReleasedScopeInput {
  before: Data;
  issues: LegacyScopeIssue[];
  snapshots: Map<string, string>;
}
/** Read each source independently. Failed contributions are never applied, rewritten,
 * retired, or included in SQL's mandatory export set. Valid inputs remain available
 * for freezing conversation rows; publishing scoped targets waits for repair. */
export function readReleasedScope(
  root: string,
  io: Pick<ExportIO, "read">,
  scope: ReleasedScope,
  context: ConversionContext,
): ReleasedScopeInput {
  const before: Data = {},
    issues: LegacyScopeIssue[] = [],
    snapshots = new Map<string, string>();
  for (const file of releasedFiles) {
    // Conversation conversion does not consume integration account documents.
    if (scope === "conversation" && file === "integrations") continue;
    const path = join(root, "config", file + ".json");
    let bytes: string | undefined;
    try {
      bytes = io.read(path);
      if (bytes === undefined) continue;
      const value = JSON.parse(bytes);
      // Current integration accounts are owned by their normal runtime loader.
      if (file === "integrations" && value?.version === 2) continue;
      if (file === "subagents") releasedCatalogSchema.parse(value);
      else if (scope === "conversation") {
        if (file === "harness") releasedConversationHarnessSchema.parse(value);
        else convertCapabilitiesV037(value);
      } else
        convertPreferencesV037(
          { [file]: value, scope },
          { ...context, report: () => {} },
        );
      before[file] = value;
      snapshots.set(path, sha256(bytes));
    } catch (error) {
      issues.push({
        file,
        path,
        reason: reason(error),
        ...(bytes === undefined ? {} : { digest: sha256(bytes) }),
      });
    }
  }
  return { before, issues, snapshots };
}
export function validateReleasedCatalog(
  input: ReleasedScopeInput,
  root: string,
  scope: ReleasedScope,
  context: ConversionContext,
): void {
  if (!input.before.subagents) return;
  try {
    splitCatalogV037(input.before.subagents, scope, context);
  } catch (error) {
    const path = join(root, "config/subagents.json");
    input.issues.push({
      file: "subagents",
      path,
      reason: reason(error),
      digest: input.snapshots.get(path),
    });
    delete input.before.subagents;
    input.snapshots.delete(path);
  }
}
export function legacyScopeFailure(
  error: unknown,
  root: string,
  io: Pick<ExportIO, "read">,
): unknown {
  if (error instanceof LegacyScopeError) return error;
  const issues: LegacyScopeIssue[] = [];
  for (const file of releasedFiles) {
    const path = join(root, "config", file + ".json");
    try {
      const bytes = io.read(path);
      if (bytes !== undefined) {
        if (file === "integrations") {
          try {
            if (JSON.parse(bytes).version === 2) continue;
          } catch {
            /* Invalid source belongs to this scope. */
          }
        }
        issues.push({
          file,
          path,
          digest: sha256(bytes),
          reason: reason(error),
        });
      }
    } catch {
      issues.push({ file, path, reason: reason(error) });
    }
  }
  return issues.length ? new LegacyScopeError(issues) : error;
}
export const scopeIssueReport = (issues: readonly LegacyScopeIssue[]) =>
  issues.map(
    (issue) =>
      `Repair required; original retained: ${issue.path}: ${issue.reason}`,
  );
function reason(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .map((issue) => `${issue.path.join("/") || "/"}: ${issue.message}`)
      .join("; ");
  return error instanceof Error
    ? error.message
    : "Legacy configuration cannot be converted";
}
