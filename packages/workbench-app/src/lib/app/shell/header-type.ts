import type { HeaderType } from "@nervekit/contracts/settings";

export type ResolvedHeaderType = Exclude<HeaderType, "auto">;

export function resolveHeaderType(
  headerType: HeaderType,
  platform?: string,
): ResolvedHeaderType {
  if (headerType !== "auto") return headerType;
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}
