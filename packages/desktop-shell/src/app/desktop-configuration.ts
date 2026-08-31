import type { Settings } from "@nervekit/contracts/settings";
import { resolveApplicationConfiguration } from "@nervekit/workbench-server";
import {
  applyElectronFontRenderHinting,
  applyElectronOzonePlatform,
  parseElectronOzonePlatform,
  resolveElectronFontRenderHinting,
} from "./cli-options.js";
import { app } from "../platform/electron/electron-api.js";
import { applyDevelopmentPerformanceDiagnostics } from "../performance/development-diagnostics.js";
import { configureApplicationLogging } from "../logging.js";

export type DesktopApplicationConfiguration = ReturnType<
  typeof resolveApplicationConfiguration
>;

export function createDesktopConfigurationController(options: {
  dataDir: string;
  performanceEnvironmentWasExplicit: boolean;
}) {
  function resolve(settings: Settings): DesktopApplicationConfiguration {
    return resolveApplicationConfiguration({
      settings,
      env: process.env,
      argv: process.argv.slice(1),
      dataDir: options.dataDir,
      platform: process.platform,
      development: !app.isPackaged,
      packaged: app.isPackaged,
    });
  }

  function apply(
    settings: Settings,
    configuration: DesktopApplicationConfiguration,
    preReady: boolean,
  ): void {
    if (process.env.NERVE_LOGGING_ENABLED !== undefined) {
      process.env.NERVE_LOGGING_ENABLED = configuration.values.loggingEnabled
        ? "1"
        : "0";
    }
    if (options.performanceEnvironmentWasExplicit) {
      process.env.NERVE_PERFORMANCE_DIAGNOSTICS = configuration.values
        .performanceEnabled
        ? "1"
        : "0";
    } else {
      process.env.NERVE_DESKTOP_SYNTHETIC_PERFORMANCE = "1";
      if (!app.isPackaged || configuration.values.performanceEnabled) {
        process.env.NERVE_PERFORMANCE_DIAGNOSTICS = configuration.values
          .performanceEnabled
          ? "1"
          : "0";
      } else {
        delete process.env.NERVE_PERFORMANCE_DIAGNOSTICS;
      }
      if (
        settings.application.diagnostics.performanceEnabled === undefined &&
        configuration.values.performanceEnabled
      ) {
        process.env.NERVE_DEVELOPMENT_PERFORMANCE_DEFAULT = "1";
      } else {
        delete process.env.NERVE_DEVELOPMENT_PERFORMANCE_DEFAULT;
      }
    }
    applyDevelopmentPerformanceDiagnostics(app.isPackaged, process.env, {
      enabled: configuration.values.performanceEnabled,
    });
    configureApplicationLogging(configuration.values.loggingEnabled);

    if (preReady) {
      applyElectronOzonePlatform(
        parseElectronOzonePlatform(configuration.values.ozonePlatform),
      );
      applyElectronFontRenderHinting(
        resolveElectronFontRenderHinting(
          configuration.values.fontRenderHinting,
        ),
      );
    }
  }

  return { resolve, apply };
}
