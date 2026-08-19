import type {
  LegacyHomeMigrationResult,
  StorageStartupOptions,
  StorageStartupResult,
} from "@nervekit/workbench-server";
import {
  coordinateStorageStartup,
  StorageStartupError,
} from "@nervekit/workbench-server";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { DaemonMode } from "../daemon.js";

export type DesktopDataDirectoryPreparation =
  | { status: "ready"; migration?: LegacyHomeMigrationResult }
  | { status: "quit" };

export interface DesktopDataDirectoryMigrationDependencies {
  coordinate?: (
    home: string,
    options: StorageStartupOptions,
  ) => Promise<StorageStartupResult>;
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, "response">>;
}

export async function prepareDesktopDataDirectory(
  input: { home: string; mode?: DaemonMode },
  dependencies: DesktopDataDirectoryMigrationDependencies,
): Promise<DesktopDataDirectoryPreparation> {
  if (input.mode === "remote") return { status: "ready" };

  let consentDenied = false;
  let result: StorageStartupResult;
  try {
    result = await (dependencies.coordinate ?? coordinateStorageStartup)(
      input.home,
      {
        requestLegacyConsent: async () => {
          const confirmation = await dependencies.showMessageBox(
            confirmationDialog(input.home),
          );
          consentDenied = confirmation.response !== 0;
          return !consentDenied;
        },
      },
    );
  } catch (error) {
    if (
      consentDenied ||
      (error instanceof StorageStartupError && error.code === "CONSENT_DENIED")
    ) {
      return { status: "quit" };
    }
    await showPreparationError(
      dependencies,
      "Nerve could not prepare its data directory",
      errorMessage(error),
    );
    return { status: "quit" };
  }

  if (result.legacyMigration) {
    await dependencies.showMessageBox(completionDialog(result.legacyMigration));
  }
  return {
    status: "ready",
    ...(result.legacyMigration ? { migration: result.legacyMigration } : {}),
  };
}

function confirmationDialog(home: string): MessageBoxOptions {
  return {
    type: "warning",
    title: "Prepare a fresh Nerve data directory",
    message: "This Nerve upgrade needs to start with fresh local data.",
    detail: [
      `The complete existing data directory at ${home} will be moved to a retained timestamped backup.`,
      "Nerve will restore your settings, custom providers and models, and recoverable provider/tool authentication.",
      "Conversations, agents, projects, logs, and history will not be imported; they remain only in the backup.",
    ].join("\n\n"),
    buttons: ["Back up and continue", "Quit"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

function completionDialog(
  migration: LegacyHomeMigrationResult,
): MessageBoxOptions {
  return {
    type: migration.credentialStatus === "failed" ? "warning" : "info",
    title: "Nerve data directory prepared",
    message: "Your legacy data is safely backed up.",
    detail: [
      `Complete backup: ${migration.backupPath}`,
      portableStateSummary(migration),
      credentialSummary(migration),
      "Conversations, agents, projects, logs, and history were not imported; they remain only in the backup.",
      "Nerve will never delete this backup automatically.",
    ].join("\n\n"),
    buttons: ["Continue to Nerve"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

function portableStateSummary(migration: LegacyHomeMigrationResult): string {
  const parts: string[] = [];
  parts.push(
    migration.settingsStatus === "imported"
      ? "Your settings were restored."
      : "No legacy settings were found to restore.",
  );
  if (migration.providerCatalogStatus === "imported") {
    const providers = migration.importedCustomProviderCount;
    const models = migration.importedCustomModelCount;
    parts.push(
      `Restored ${providers} custom ${providers === 1 ? "provider" : "providers"} and ${models} custom ${models === 1 ? "model" : "models"}.`,
    );
  } else {
    parts.push("No custom provider or model definitions were found.");
  }
  return parts.join(" ");
}

function credentialSummary(migration: LegacyHomeMigrationResult): string {
  if (migration.credentialStatus === "failed") {
    return "Provider and tool authentication could not be restored. Sign in to those providers again in the fresh data directory.";
  }
  if (migration.credentialStatus === "none") {
    return "No stored provider or tool authentication was found to restore.";
  }
  const noun =
    migration.importedCredentialCount === 1 ? "credential" : "credentials";
  return `Restored ${migration.importedCredentialCount} provider/tool ${noun}.`;
}

async function showPreparationError(
  dependencies: DesktopDataDirectoryMigrationDependencies,
  message: string,
  detail: string,
): Promise<void> {
  await dependencies.showMessageBox({
    type: "error",
    title: "Nerve startup stopped",
    message,
    detail,
    buttons: ["Quit"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
