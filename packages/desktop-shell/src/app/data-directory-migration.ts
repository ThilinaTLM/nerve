import { initializeStorage } from "@nervekit/workbench-server";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { DaemonMode } from "../daemon.js";

export type DesktopDataDirectoryPreparation =
  | { status: "ready" }
  | { status: "quit" };

export interface DesktopDataDirectoryMigrationDependencies {
  initialize?: typeof initializeStorage;
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, "response">>;
}

/** Strictly validate or create a v1 Nerve home; older layouts are not read. */
export async function prepareDesktopDataDirectory(
  input: { home: string; mode?: DaemonMode },
  dependencies: DesktopDataDirectoryMigrationDependencies,
): Promise<DesktopDataDirectoryPreparation> {
  if (input.mode === "remote") return { status: "ready" };
  try {
    const storage = await (dependencies.initialize ?? initializeStorage)(
      input.home,
    );
    await storage.canonicalStore.close();
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
