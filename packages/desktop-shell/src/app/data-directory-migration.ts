import {
  initializeStorage,
  inspectNerveHome,
} from "@nervekit/workbench-server";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { DaemonMode } from "../daemon/composition.js";

export type DesktopDataDirectoryPreparation =
  | { status: "ready" }
  | { status: "quit" };
export interface DesktopDataDirectoryMigrationDependencies {
  initialize?: typeof initializeStorage;
  inspect?: typeof inspectNerveHome;
  showMessageBox(
    options: MessageBoxOptions,
  ): Promise<Pick<MessageBoxReturnValue, "response">>;
}

/** Core migrations run on core.sqlite; legacy data is imported explicitly. */
export async function prepareDesktopDataDirectory(
  input: {
    home: string;
    mode?: DaemonMode;
    onProgress?: (message: string) => void;
  },
  dependencies: DesktopDataDirectoryMigrationDependencies,
): Promise<DesktopDataDirectoryPreparation> {
  if (input.mode === "remote") return { status: "ready" };
  try {
    input.onProgress?.("Checking local storage");
    const inspection = await (dependencies.inspect ?? inspectNerveHome)(
      input.home,
    );
    if (inspection.kind === "unsupported") throw new Error(inspection.reason);
    await (dependencies.initialize ?? initializeStorage)(input.home);
    return { status: "ready" };
  } catch (error) {
    await dependencies.showMessageBox({
      type: "error",
      title: "Local storage could not be opened",
      message: error instanceof Error ? error.message : String(error),
      buttons: ["Quit"],
    });
    return { status: "quit" };
  }
}
