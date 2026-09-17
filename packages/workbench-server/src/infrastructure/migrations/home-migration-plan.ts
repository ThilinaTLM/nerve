import { createHash } from "node:crypto";
import type {
  CurrentHomeMigrationPlan,
  HomeMigrationIssue,
} from "@nervekit/contracts/storage";
import { inspectCanonicalSchema } from "../persistence/canonical-sqlite/index.js";
import { storagePaths } from "../storage-bootstrap/paths.js";
import {
  inspectToolResultPayloadReferenceMigration,
  TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION,
} from "./tool-result-payload-reference-v2.js";

export class HomeMigrationBlockedError extends Error {
  constructor(readonly plan: CurrentHomeMigrationPlan) {
    super(
      `Nerve storage migration requires a decision for ${plan.issues.length} issue${plan.issues.length === 1 ? "" : "s"}: ${plan.issues[0]?.reason ?? "unknown migration issue"}`,
    );
    this.name = "HomeMigrationBlockedError";
  }
}

export async function inspectPendingHomeMigrations(
  home: string,
): Promise<CurrentHomeMigrationPlan> {
  const paths = storagePaths(home);
  const schema = inspectCanonicalSchema(paths.sqlitePath);
  const migrationIds: string[] = [];
  const issues: HomeMigrationIssue[] = [];
  if (schema.kind === "unsupported-newer" || schema.kind === "uninitialized") {
    issues.push(
      issue({
        migrationId: "canonical-schema",
        scope: "global",
        disposition: "required",
        code: "UNSUPPORTED_SCHEMA",
        reason:
          schema.kind === "unsupported-newer"
            ? `Storage schema v${schema.version} is newer than this Nerve version.`
            : "The canonical storage schema is not initialized.",
      }),
    );
  } else {
    if (schema.kind === "migration-required") {
      migrationIds.push(`canonical-schema-after-v${schema.version}`);
    }
    const toolResult = await inspectToolResultPayloadReferenceMigration(paths);
    if (toolResult.required) {
      migrationIds.push(TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION);
      for (const found of toolResult.issues) {
        issues.push(
          issue({
            migrationId: TOOL_RESULT_PAYLOAD_REFERENCE_V2_MIGRATION,
            scope: found.conversationId ? "conversation" : "global",
            disposition: found.conversationId ? "skippable" : "required",
            code: found.code,
            reason: found.reason,
            conversationId: found.conversationId,
          }),
        );
      }
    }
  }
  migrationIds.sort();
  issues.sort((left, right) => left.id.localeCompare(right.id));
  return {
    format: "nerve-current-home-migration-plan",
    version: 1,
    fingerprint: fingerprint({ migrationIds, issues }),
    migrationIds,
    issues,
  };
}

function issue(value: Omit<HomeMigrationIssue, "id">): HomeMigrationIssue {
  return {
    ...value,
    id: createHash("sha256")
      .update(
        JSON.stringify([
          value.migrationId,
          value.scope,
          value.code,
          value.conversationId,
          value.reason,
        ]),
      )
      .digest("hex"),
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
