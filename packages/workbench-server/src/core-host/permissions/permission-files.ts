import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Diagnostic } from "@nervekit/contracts/configuration";
import {
  permissionOverlayDocumentForOriginSchema,
  permissionRuleSetSchema,
  type PermissionOverlayDocument,
  type PermissionRuleSet,
} from "@nervekit/contracts/permissions";
import { isPathInside } from "@nervekit/tools/execution";
import { projectPermissionValue } from "./project-permission-migrations.js";

/** A permission file as read from disk; parsing happens in `parsePermissionFile`. */
export type LoadedPermissionFile =
  | { kind: "missing" }
  | { kind: "bytes"; bytes: string }
  | { kind: "error"; message: string };

export type PermissionFileIdentity = {
  scope: "user" | "project" | "conversation";
  /** `permissions.json` or `rule-set:<id>`. */
  document: string;
  kind: "permission-overlay" | "rule-set";
};

/** How one permission file fared in a `check` or a `reload`. */
export type PermissionFileReport = PermissionFileIdentity & {
  path: string;
  /** Empty when the file is valid or absent. */
  diagnostics: Diagnostic[];
  /** Digest of the bytes on disk, for comparing with a trust decision; absent when there is no file. */
  contentDigest?: string;
  /** After a reload: the file on disk is invalid, so the version loaded before it stays in force. */
  previousVersionActive?: true;
};

export type ParsedPermissionFile =
  | {
      ok: true;
      overlay?: PermissionOverlayDocument;
      ruleSet?: PermissionRuleSet;
    }
  | { ok: false; diagnostics: Diagnostic[] };

const MAX_ISSUES = 5;

export const ruleSetDirectory = (home: string) =>
  join(home, "config", "rule-sets");

export async function readPermissionFile(
  path: string,
): Promise<LoadedPermissionFile> {
  try {
    return { kind: "bytes", bytes: await readFile(path, "utf8") };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "error", message: (error as Error).message };
  }
}

/** Which file a path is, from where it lies under the home. */
export function identifyPermissionFile(
  home: string,
  path: string,
): PermissionFileIdentity {
  if (isPathInside(ruleSetDirectory(home), path))
    return {
      scope: "user",
      kind: "rule-set",
      document: `rule-set:${basename(path, ".json")}`,
    };
  const scope = isPathInside(join(home, "config"), path)
    ? "user"
    : isPathInside(join(home, "data", "conversations"), path)
      ? "conversation"
      : "project";
  return { scope, kind: "permission-overlay", document: basename(path) };
}

function problems(error: unknown): Diagnostic[] {
  const issues =
    typeof error === "object" && error !== null && "issues" in error
      ? (
          error as {
            issues: { code?: string; path: PropertyKey[]; message: string }[];
          }
        ).issues
      : undefined;
  if (!issues?.length)
    return [
      {
        level: "error",
        code: "invalid-value",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  const shown = issues.slice(0, MAX_ISSUES).map(
    (issue): Diagnostic => ({
      level: "error",
      code:
        issue.code === "unrecognized_keys" ? "unknown-field" : "invalid-value",
      message: issue.message,
      ...(issue.path.length > 0
        ? { pointer: `/${issue.path.map(String).join("/")}` }
        : {}),
    }),
  );
  if (issues.length > MAX_ISSUES)
    shown[MAX_ISSUES - 1].message +=
      ` (and ${issues.length - MAX_ISSUES} more problems)`;
  return shown;
}

/**
 * The one place a permission file is validated: the policy composes from what this returns,
 * and `check`/`reload` report its diagnostics. An absent file is valid and contributes nothing.
 */
export function parsePermissionFile(
  identity: PermissionFileIdentity,
  loaded: LoadedPermissionFile,
): ParsedPermissionFile {
  if (loaded.kind === "missing") return { ok: true };
  if (loaded.kind === "error")
    return {
      ok: false,
      diagnostics: [
        {
          level: "error",
          code: "io-error",
          message: `Could not be read: ${loaded.message}`,
        },
      ],
    };
  let value: unknown;
  try {
    value = JSON.parse(loaded.bytes);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          level: "error",
          code: "malformed-json",
          message: `Not valid JSON: ${(error as Error).message}`,
        },
      ],
    };
  }
  try {
    if (identity.kind === "rule-set")
      return { ok: true, ruleSet: permissionRuleSetSchema.parse(value) };
    return {
      ok: true,
      overlay:
        identity.scope === "project"
          ? projectPermissionValue(value)
          : permissionOverlayDocumentForOriginSchema(identity.scope).parse(
              value,
            ),
    };
  } catch (error) {
    return { ok: false, diagnostics: problems(error) };
  }
}
