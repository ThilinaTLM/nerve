import type { SdkEnvironment } from "../sdk-types.js";

/** Lists an entity the run created, updated or deleted in the result footer. */
export function noteChange(
  env: SdkEnvironment,
  kind: "created" | "updated" | "deleted",
  what: string,
): void {
  env.report[kind].push(what);
}
