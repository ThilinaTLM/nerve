import {
  initializeStorage,
  inspectLegacyV2Home,
  inspectNerveHome,
  migrateLegacyV2Home,
} from "@nervekit/workbench-server";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { DaemonMode } from "../daemon.js";

export type DesktopDataDirectoryPreparation =
  | { status: "ready" }
  | { status: "quit" };

export interface DesktopDataDirectoryMigrationDependencies {
  initialize?: typeof initializeStorage;
  inspect?: typeof inspectNerveHome;
  inspectLegacy?: typeof inspectLegacyV2Home;
  migrate?: typeof migrateLegacyV2Home;
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, "response">>;
}

/** Strictly initialize v1, or explicitly migrate the immediately preceding v2 home. */
export async function prepareDesktopDataDirectory(
  input: { home: string; mode?: DaemonMode },
  dependencies: DesktopDataDirectoryMigrationDependencies,
): Promise<DesktopDataDirectoryPreparation> {
  if (input.mode === "remote") return { status: "ready" };
  const inspect = dependencies.inspect ?? inspectNerveHome;
  const inspectLegacy = dependencies.inspectLegacy ?? inspectLegacyV2Home;
  const initialize = dependencies.initialize ?? initializeStorage;
  try {
    const current = await inspect(input.home);
    if (current.kind !== "unsupported") {
      const storage = await initialize(input.home);
      await storage.canonicalStore.close();
      return { status: "ready" };
    }

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
    return { status: "ready" };
  } catch (error) {
    await dependencies.showMessageBox({
      type: "error",
      title: "Nerve startup stopped",
      message: "Nerve could not open its home directory",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["Quit"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return { status: "quit" };
  }
}
