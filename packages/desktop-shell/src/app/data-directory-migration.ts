import * as workbenchServer from "@nervekit/workbench-server";
import type {
  HomeMigrationApproval,
  HomeMigrationFailure,
  HomeMigrationPlan,
  HomeMigrationResult,
} from "@nervekit/contracts/storage";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { DaemonMode } from "../daemon/composition.js";

const {
  applyHomeMigrationPlan,
  initializeStorage,
  inspectLegacyV2Home,
  inspectNerveHome,
  inspectPendingHomeMigrations,
  migrateLegacyV2Home,
} = workbenchServer;

export type DesktopDataDirectoryPreparation =
  | { status: "ready" }
  | { status: "quit" };

type InspectUnifiedMigrations = (home: string) => Promise<HomeMigrationPlan>;
type ApplyUnifiedMigrations = (
  home: string,
  plan: HomeMigrationPlan,
  approval: HomeMigrationApproval,
) => Promise<HomeMigrationResult>;

export interface UnifiedMigrationServerAdapter {
  inspect: InspectUnifiedMigrations;
  apply: ApplyUnifiedMigrations;
}

/**
 * Resolves the runner's public adapters without statically requiring exports
 * that are landing independently. The namespace import makes those adapters
 * available automatically as soon as the server package exports both names.
 */
export function resolveUnifiedMigrationServerAdapter(
  server: object,
): UnifiedMigrationServerAdapter | undefined {
  const inspect = Reflect.get(server, "inspectStorageMigrationPlan");
  const apply = Reflect.get(server, "applyStorageMigrationPlan");
  if (typeof inspect !== "function" || typeof apply !== "function") {
    return undefined;
  }
  return {
    inspect: inspect as InspectUnifiedMigrations,
    apply: apply as ApplyUnifiedMigrations,
  };
}

const defaultUnifiedMigrationAdapter =
  resolveUnifiedMigrationServerAdapter(workbenchServer);

export interface DesktopDataDirectoryMigrationDependencies {
  initialize?: typeof initializeStorage;
  inspect?: typeof inspectNerveHome;
  inspectLegacy?: typeof inspectLegacyV2Home;
  migrate?: typeof migrateLegacyV2Home;
  inspectCurrentMigrations?: typeof inspectPendingHomeMigrations;
  applyCurrentMigrations?: typeof applyHomeMigrationPlan;
  /** New unified planner hook. Legacy current-home migration remains the fallback. */
  inspectUnifiedMigrations?: InspectUnifiedMigrations;
  applyUnifiedMigrations?: ApplyUnifiedMigrations;
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, "response">>;
}

class DesktopMigrationDeclined extends Error {}

class DesktopMigrationError extends Error {
  constructor(
    readonly failure: HomeMigrationFailure,
    message = failure.message,
  ) {
    super(message);
    this.name = "DesktopMigrationError";
  }
}

/** Strictly initialize a Nerve home, or explicitly migrate supported older homes. */
export async function prepareDesktopDataDirectory(
  input: {
    home: string;
    mode?: DaemonMode;
    onProgress?: (message: string) => void;
  },
  dependencies: DesktopDataDirectoryMigrationDependencies,
): Promise<DesktopDataDirectoryPreparation> {
  if (input.mode === "remote") return { status: "ready" };
  const inspect = dependencies.inspect ?? inspectNerveHome;
  const inspectLegacy = dependencies.inspectLegacy ?? inspectLegacyV2Home;
  const initialize = dependencies.initialize ?? initializeStorage;
  const inspectUnifiedMigrations =
    dependencies.inspectUnifiedMigrations ??
    defaultUnifiedMigrationAdapter?.inspect;
  const applyUnifiedMigrations =
    dependencies.applyUnifiedMigrations ??
    defaultUnifiedMigrationAdapter?.apply;
  try {
    input.onProgress?.("Checking local storage");
    const current = await inspect(input.home);
    if (current.kind !== "unsupported") {
      if (current.kind === "current") {
        input.onProgress?.("Planning storage upgrade");
        const legacyMigrationPlan = dependencies.inspectUnifiedMigrations
          ? {
              format: "nerve-current-home-migration-plan" as const,
              version: 1 as const,
              fingerprint: "0".repeat(64),
              migrationIds: [],
              issues: [],
            }
          : await (
              dependencies.inspectCurrentMigrations ??
              inspectPendingHomeMigrations
            )(input.home);
        if (
          inspectUnifiedMigrations &&
          legacyMigrationPlan.migrationIds.length === 0 &&
          legacyMigrationPlan.issues.length === 0
        ) {
          const migrationPlan = await inspectUnifiedMigrations(input.home);
          await prepareUnifiedHomeMigration(input.home, migrationPlan, {
            reportProgress: input.onProgress,
            ...dependencies,
            applyUnifiedMigrations,
          });
        } else {
          const migrationPlan = legacyMigrationPlan;
          const fatal = migrationPlan.issues.find(
            (issue) => issue.disposition === "required",
          );
          if (fatal) throw new Error(fatal.reason);
          const skippable = migrationPlan.issues.filter(
            (issue) => issue.disposition === "skippable",
          );
          const affectedConversations = new Set(
            skippable.flatMap((issue) =>
              issue.conversationId ? [issue.conversationId] : [],
            ),
          ).size;
          let approvedIssueIds: string[] = [];
          if (skippable.length > 0) {
            const consent = await dependencies.showMessageBox({
              type: "warning",
              title: "Some conversations cannot be migrated",
              message: `${affectedConversations} conversation${affectedConversations === 1 ? "" : "s"} cannot be upgraded`,
              detail: [
                "Nerve can skip only the affected conversations and continue upgrading the rest of your data.",
                "The complete current home will be retained under backups/ so the skipped history can be recovered later.",
              ].join("\n\n"),
              buttons: ["Skip affected conversations and continue", "Quit"],
              defaultId: 1,
              cancelId: 1,
              noLink: true,
            });
            if (consent.response !== 0) return { status: "quit" };
            approvedIssueIds = skippable.map((issue) => issue.id);
          }
          if (migrationPlan.migrationIds.length > 0) {
            input.onProgress?.("Applying storage upgrade");
            const report = await (
              dependencies.applyCurrentMigrations ?? applyHomeMigrationPlan
            )(input.home, migrationPlan, {
              fingerprint: migrationPlan.fingerprint,
              approvedIssueIds,
            });
            if (report.skippedConversations.length > 0) {
              await dependencies.showMessageBox({
                type: "warning",
                title: "Nerve home migration complete",
                message: "Your remaining Nerve data is ready",
                detail: [
                  `Skipped ${report.skippedConversations.length} conversation${report.skippedConversations.length === 1 ? "" : "s"}.`,
                  report.backupPath
                    ? `The complete previous home is retained at ${report.backupPath}.`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                buttons: ["Continue"],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
            }
          }
        }
      }
      input.onProgress?.(
        current.kind === "missing" || current.kind === "empty"
          ? "Creating local storage"
          : "Verifying local storage",
      );
      const storage = await initialize(input.home);
      await storage.canonicalStore.close();
      input.onProgress?.("Local storage is ready");
      return { status: "ready" };
    }

    input.onProgress?.("Checking previous storage format");
    const legacy = await inspectLegacy(input.home);
    if (legacy.kind !== "legacy-v2") throw new Error(current.reason);
    const consent = await dependencies.showMessageBox({
      type: "warning",
      title: "Migrate Nerve home",
      message: "Nerve found storage from the previous version",
      detail: [
        "Nerve can migrate settings, provider and tool authentication, projects, agents, conversations, referenced payloads, and plans into the new storage architecture.",
        "Logs, caches, temporary files, task process state, task logs, daemon metadata, and TLS identity will not be restored to the live home. The complete old home will be retained under backups/.",
        "Quit every other Nerve process before continuing. Migration does not modify the old home until the new home has been fully validated.",
      ].join("\n\n"),
      buttons: ["Migrate and continue", "Quit"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (consent.response !== 0) return { status: "quit" };

    input.onProgress?.("Migrating previous Nerve data");
    const report = await (dependencies.migrate ?? migrateLegacyV2Home)(
      input.home,
    );
    await dependencies.showMessageBox({
      type: report.warnings.length > 0 ? "warning" : "info",
      title: "Nerve home migration complete",
      message: "Your Nerve data is ready",
      detail: [
        `Migrated ${report.counts.conversations} conversations, ${report.counts.projects} projects, ${report.counts.agents} agents, and ${report.counts.credentials} credentials.`,
        `The complete previous home is retained at ${report.backupPath}.`,
        ...report.warnings,
      ].join("\n\n"),
      buttons: ["Continue"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    input.onProgress?.("Local storage is ready");
    return { status: "ready" };
  } catch (error) {
    if (error instanceof DesktopMigrationDeclined) return { status: "quit" };
    const failure = migrationFailureFrom(error);
    const retryable = failure?.retryable === true;
    const response = await dependencies.showMessageBox({
      type: "error",
      title: "Nerve startup stopped",
      message: "Nerve could not open its home directory",
      detail: migrationErrorDetail(error, input.home),
      buttons: retryable ? ["Try again", "Quit"] : ["Quit"],
      defaultId: retryable ? 1 : 0,
      cancelId: retryable ? 1 : 0,
      noLink: true,
    });
    if (retryable && response.response === 0) {
      return prepareDesktopDataDirectory(input, dependencies);
    }
    return { status: "quit" };
  }
}

async function prepareUnifiedHomeMigration(
  home: string,
  plan: HomeMigrationPlan,
  dependencies: DesktopDataDirectoryMigrationDependencies & {
    reportProgress?: (message: string) => void;
  },
): Promise<void> {
  if (["ahead", "invalid", "corrupt", "drift"].includes(plan.outcome)) {
    throw new DesktopMigrationError(
      plan.failure ?? {
        code: `MIGRATION_${plan.outcome.toUpperCase()}`,
        phase: "plan",
        message: plan.message ?? plannerFailureMessage(plan.outcome),
        retryable: false,
      },
    );
  }
  if (plan.outcome === "current") return;
  if (!dependencies.applyUnifiedMigrations) {
    throw new DesktopMigrationError({
      code: "MIGRATION_APPLY_UNAVAILABLE",
      phase: "plan",
      message: "This Nerve build cannot apply the required storage migration.",
      retryable: false,
    });
  }

  const approvalEntries =
    plan.quarantine?.entries.filter((entry) => entry.requiresApproval) ?? [];
  let approvedQuarantineIds: string[] = [];
  if (approvalEntries.length > 0) {
    const affectedRecords = approvalEntries.reduce(
      (total, entry) => total + entry.affectedRecords,
      0,
    );
    const consent = await dependencies.showMessageBox({
      type: "warning",
      title: "Some data cannot be migrated",
      message: `${affectedRecords} record${affectedRecords === 1 ? "" : "s"} will be quarantined`,
      detail: [
        "Nerve can isolate the affected data and continue upgrading the rest of your home.",
        "The current home will be retained as a snapshot so the quarantined data can be recovered with diagnostic tools.",
      ].join("\n\n"),
      buttons: ["Quarantine affected data and continue", "Quit"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (consent.response !== 0) throw new DesktopMigrationDeclined();
    approvedQuarantineIds = approvalEntries.map((entry) => entry.id);
  }

  dependencies.reportProgress?.("Applying storage upgrade");
  const result = await dependencies.applyUnifiedMigrations(home, plan, {
    fingerprint: plan.fingerprint,
    approvedQuarantineIds,
  });
  if (result.quarantine.total > 0) {
    await dependencies.showMessageBox({
      type: "warning",
      title: "Nerve home migration complete",
      message: "Your remaining Nerve data is ready",
      detail: [
        `Quarantined ${result.quarantine.total} item${result.quarantine.total === 1 ? "" : "s"} affecting ${result.quarantine.affectedRecords} record${result.quarantine.affectedRecords === 1 ? "" : "s"}.`,
        result.snapshotPath
          ? `The complete previous home is retained at ${result.snapshotPath}.`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
      buttons: ["Continue"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  }
}

function plannerFailureMessage(outcome: HomeMigrationPlan["outcome"]): string {
  switch (outcome) {
    case "ahead":
      return "This home was upgraded by a newer Nerve build. Open it with that newer build.";
    case "drift":
      return "Draft migrations changed on this disposable home. Review and repair it with the migration CLI before retrying.";
    case "invalid":
      return "This home has an invalid migration state. Review the diagnostics before retrying.";
    case "corrupt":
      return "This home's migration history does not match this build. Review the diagnostics before retrying.";
    default:
      return `This Nerve home cannot be opened because its migration state is ${outcome}.`;
  }
}

function migrationFailureFrom(
  error: unknown,
): HomeMigrationFailure | undefined {
  if (error instanceof DesktopMigrationError) return error.failure;
  if (
    error !== null &&
    typeof error === "object" &&
    "failure" in error &&
    isMigrationFailure(error.failure)
  ) {
    return error.failure;
  }
  return undefined;
}

function isMigrationFailure(value: unknown): value is HomeMigrationFailure {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    typeof value.code === "string" &&
    "phase" in value &&
    typeof value.phase === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    "retryable" in value &&
    typeof value.retryable === "boolean"
  );
}

function migrationErrorDetail(error: unknown, home: string): string {
  const failure = migrationFailureFrom(error);
  if (!failure) return error instanceof Error ? error.message : String(error);
  return [
    failure.message,
    `Code: ${failure.code}`,
    `Phase: ${failure.phase}`,
    failure.stepId ? `Step: ${failure.stepId}` : undefined,
    `Diagnostics: ${home}/logs`,
  ]
    .filter(Boolean)
    .join("\n");
}
