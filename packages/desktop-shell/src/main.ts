import { isAbsolute, relative, resolve } from "node:path";
import { defaultSettings } from "@nervekit/contracts/settings";
import { resolveDataDir } from "@nervekit/workbench-server";
import { parseDesktopOptions } from "./app/cli-options.js";
import { createDesktopConfigurationController } from "./app/desktop-configuration.js";
import { createDesktopRuntime } from "./app/create-desktop-runtime.js";
import { DESKTOP_APP_ID, DESKTOP_APP_NAME } from "./desktop-identity.js";
import { app } from "./platform/electron/electron-api.js";

const desktopOptions = parseDesktopOptions(process.argv.slice(1));
const desktopDataDir = resolveDataDir();
const electronProfileDir = resolve(app.getPath("userData"));
const profileRelativeToHome = relative(
  resolve(desktopDataDir),
  electronProfileDir,
);
if (
  profileRelativeToHome === "" ||
  (!profileRelativeToHome.startsWith("..") &&
    !isAbsolute(profileRelativeToHome))
) {
  throw new Error("Electron userData must remain outside NERVE_HOME.");
}

const desktopConfigurationController = createDesktopConfigurationController({
  dataDir: desktopDataDir,
  performanceEnvironmentWasExplicit:
    process.env.NERVE_PERFORMANCE_DIAGNOSTICS !== undefined,
});
const desktopConfiguration =
  desktopConfigurationController.resolve(defaultSettings);
desktopConfigurationController.apply(
  defaultSettings,
  desktopConfiguration,
  true,
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(DESKTOP_APP_NAME);
  app.setAppUserModelId(DESKTOP_APP_ID);
  createDesktopRuntime({
    desktopOptions,
    desktopDataDir,
    desktopConfigurationController,
    desktopConfiguration,
  }).start();
}
