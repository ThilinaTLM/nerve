import type { ApplicationConfigurationSnapshot } from "@nervekit/contracts/settings";

type Application = ApplicationConfigurationSnapshot["application"];

/** Which restarts saved application settings are waiting for. */
export function pendingRestarts(
  configuration: ApplicationConfigurationSnapshot,
  /** Only these groups of `configuration.application`; all when omitted. */
  groups?: readonly (keyof Application)[],
): { daemon: boolean; desktop: boolean } {
  const application = configuration.application;
  const items = (
    groups ?? (Object.keys(application) as (keyof Application)[])
  ).flatMap((key) => Object.values(application[key]));
  const pending = (target: "daemon" | "desktop") =>
    items.some((item) => item.pendingRestart && item.restartTarget === target);
  return { daemon: pending("daemon"), desktop: pending("desktop") };
}
